import { Injectable, NotFoundException } from '@nestjs/common';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { ResolveCredentialOwnerUseCase } from '../llm/resolve-credential-owner.use-case';

/**
 * O **remoto de trabalho** de um projeto: o que o engine precisa para buscar e
 * empurrar (ADR 0056).
 *
 * O engine trabalha no sistema de arquivos e não tem a chave mestra; ela é da
 * api. Em vez de replicar o segredo, o engine pede isto aqui pelo canal
 * `/internal/*` no momento em que precisa, e nunca persiste o que recebe.
 *
 * `provider: local` não tem credencial nem tem o que decifrar — o remoto é o
 * caminho do bare repo, e o resto do caminho não sabe a diferença.
 */
export interface ProjectGitRemote {
  /** `local` = caminho no disco; `remote` = URL que exige autenticação. */
  kind: 'local' | 'remote';
  /** O que vira `git remote add origin <isto>`. Sem credencial embutida. */
  origin: string;
  defaultBranch: string;
  /**
   * Só para `remote`. Quem consome injeta por invocação e NUNCA escreve em
   * arquivo — ver a decisão 2 do ADR 0056 e o porquê dela (RN-075 deu ao dev
   * agent leitura auto-aprovada dentro da pasta do projeto, e `.git/config`
   * está dentro dela).
   */
  token?: string;
  /** Usuário do par HTTP Basic; o token é a senha. */
  username?: string;
}

/** GitHub aceita qualquer usuário com PAT como senha; este é o valor canônico. */
const USUARIO_DE_TOKEN = 'x-access-token';

@Injectable()
export class GetProjectGitRemoteUseCase {
  constructor(
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly resolveCredentialOwner: ResolveCredentialOwnerUseCase,
  ) {}

  async execute(projectId: string): Promise<ProjectGitRemote> {
    const repo = await this.repositories.findByProjectId(projectId);
    if (!repo) {
      throw new NotFoundException(
        `Projeto sem repositório provisionado: ${projectId}`,
      );
    }

    if (repo.provider === 'local') {
      // `external_id` é o caminho do bare repo — é o que o engine já usava.
      return {
        kind: 'local',
        origin: repo.externalId,
        defaultBranch: repo.defaultBranch,
      };
    }

    // Do OWNER do workspace, não de quem abriu a sessão: mesma regra da
    // RN-058 para chave de LLM, e reusando o mesmo resolvedor de propósito —
    // duas regras de "de quem é a credencial" divergiriam com o tempo.
    const ownerId = await this.resolveCredentialOwner.execute(projectId);
    const secret = await this.userCredentials.findSecretByUserAndProvider(
      ownerId,
      repo.provider,
    );

    if (!secret) {
      // Mensagem endereçada a quem vai ler o desfecho da falha: diz de QUEM é
      // a credencial que falta, porque "sem credencial" manda procurar no
      // lugar errado (o usuário da sessão).
      throw new NotFoundException(
        `O owner do workspace não tem credencial ${repo.provider} cadastrada — ` +
          `o engine não tem como buscar nem empurrar no repositório do projeto`,
      );
    }

    return {
      kind: 'remote',
      origin: repo.url,
      defaultBranch: repo.defaultBranch,
      token: this.encryption.decrypt(secret),
      username: USUARIO_DE_TOKEN,
    };
  }
}
