import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ResolveEffectiveRoleUseCase } from '../iam/resolve-effective-role.use-case';
import { roleAtLeast, type Role } from '../../../domain/iam/role';

/**
 * O papel mínimo para um projeto APARECER nesta lista. É o MESMO de
 * `POST .../runner-ticket` de propósito: a lista existe para o agente local
 * abrir uma conexão por projeto, e cada conexão começa por um ticket. Listar
 * projeto para o qual o ticket seria recusado seria prometer o que a rota
 * seguinte nega.
 */
export const PAPEL_MINIMO_PARA_ATENDER: Role = 'developer';

/** O que o agente local precisa saber de cada projeto que atende. */
export interface ProjetoAtendidoPeloRunner {
  projectId: string;
  name: string;
  /**
   * O nome da pasta do projeto (RN-109) — o SEGMENTO relativo sob a base da
   * máquina, nunca um caminho absoluto. A raiz é de quem executa, o mesmo
   * invariante do broker (ADR 0144/0141).
   */
  workspaceDirName: string;
  /**
   * Quando o runner confirmou a pasta pela primeira vez (RN-423), ou `null`
   * se nunca confirmou. É registro de uma CONFIRMAÇÃO, não batimento
   * (RN-468) — não diz que a pasta está de pé agora.
   */
  workspaceVerifiedAt: Date | null;
}

/**
 * Os projetos em modo `runner` que este usuário atende (RN-543, ADR 0154
 * ponto 3) — a rota `GET /runner/projects`, que o agente de MÁQUINA consulta
 * no start para abrir uma conexão por projeto.
 *
 * ## Ele PERGUNTA em vez de varrer o disco
 *
 * A base da máquina é do usuário e pode ter pasta que não é projeto nenhum;
 * adivinhar por nome de pasta é a classe de erro que o ADR 0141 recusou ao
 * proibir `PROJECT_WORKSPACES_HOST_DIR` como base. A api é quem sabe.
 *
 * ## O mínimo é por LINHA, e não da rota
 *
 * A rota não tem `:projectId` no caminho — não há contra o que resolver um
 * `@RequireRole`. Então o mínimo (`PAPEL_MINIMO_PARA_ATENDER`) é aplicado
 * projeto a projeto, com a régua ÚNICA do produto
 * (`ResolveEffectiveRoleUseCase.forProject`, `projectRole ?? workspaceRole` —
 * RN-471). O efeito é o mesmo de sempre e nada afrouxa: o que sai daqui é
 * exatamente o conjunto de projetos para os quais `runner-ticket` já
 * autorizaria este usuário.
 *
 * N consultas para N projetos é aceito e medido: N é o número de projetos em
 * modo `runner` que UMA pessoa alcança, e a alternativa seria reescrever o
 * `??` em SQL — uma segunda régua para a regra que o repositório mantém numa
 * fonte só.
 */
@Injectable()
export class ListRunnerProjectsUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
  ) {}

  async execute(userId: string): Promise<ProjetoAtendidoPeloRunner[]> {
    const candidatos = await this.projects.listRunnerModeReachableBy(userId);

    const atendidos: ProjetoAtendidoPeloRunner[] = [];
    for (const projeto of candidatos) {
      const papel = await this.resolveEffectiveRole.forProject(
        userId,
        projeto.id,
      );
      if (!papel || !roleAtLeast(papel, PAPEL_MINIMO_PARA_ATENDER)) continue;

      atendidos.push({
        projectId: projeto.id,
        name: projeto.name,
        workspaceDirName: projeto.workspaceDirName,
        workspaceVerifiedAt: projeto.workspaceVerifiedAt,
      });
    }
    return atendidos;
  }
}
