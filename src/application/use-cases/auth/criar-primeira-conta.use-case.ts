import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuthEventRecorder } from '../../ports/auth-event-recorder.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserRepository } from '../../ports/user-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import { assuntoDoUsuario } from '../../../domain/auth/auth-event';
import { normalizarEmail } from '../../../domain/auth/email';
import {
  exigirSenhaValida,
  PoliticaDeSenhaError,
} from '../../../domain/auth/password-policy';
import { nomeESlugDoWorkspacePessoal } from '../../../domain/auth/personal-workspace';
import { ProvisionarUsuarioUseCase } from './provisionar-usuario.use-case';

/** O que o instalador precisa gravar no marcador. E-mail identifica; não é segredo. */
export interface PrimeiraContaCriada {
  userId: string;
  email: string;
  workspaceId: string;
}

/**
 * A PRIMEIRA conta da instalação, criada pelo instalador (RN-546, ADR 0155).
 *
 * ## Por que este caminho existe
 *
 * Numa instalação nova ninguém consegue entrar. Medido na FASE 30: o `.env`
 * que o `install.sh` gera não tem variável de e-mail nenhuma,
 * `MAIL_TRANSPORT` cai no default `log`, e o registro normal exige verificar
 * e-mail — que por um canal desligado não fecha. A instalação de uma linha
 * termina dizendo "Pronto" e a única saída é pescar o link em
 * `docker compose logs api`.
 *
 * ## A conta nasce VERIFICADA, e o motivo é o que autoriza
 *
 * O que a verificação de e-mail prova é *"esta pessoa controla esta caixa"*.
 * Quem roda o instalador já provou algo mais forte: controla a MÁQUINA, o
 * `.env` com os cinco segredos e o daemon do Docker. Exigir dela a prova mais
 * fraca, por um canal que a instalação sabe estar desligado, é teatro.
 *
 * Isso NÃO afrouxa o registro normal, que fica byte a byte. Este é um caminho
 * para um caso nomeado, não uma mudança no outro.
 *
 * ## Só a PRIMEIRA, e a condição é sobre a INSTALAÇÃO
 *
 * `existeAlgumUsuario()`, nunca "este e-mail já existe". `ProvisionarUsuario`
 * é idempotente por e-mail, e herdar essa idempotência aqui transformaria a
 * rota num criador de contas com um nome enganoso: bastaria variar o e-mail.
 * Havendo QUALQUER usuário, a rota recusa — e numa migração (RN-530), em que
 * os usuários vêm no restore, ela se cala pelo mesmo critério.
 *
 * A janela entre a pergunta e a escrita é estreita e está declarada: a
 * checagem roda DENTRO da transação, mas `READ COMMITTED` não impede duas
 * chamadas concorrentes de passarem juntas com e-mails diferentes. Fechá-la
 * exigiria um lock consultivo sobre a ausência de linhas, e não é onde a
 * contenção mora: quem alcança esta rota já tem o `BRABO_SERVICE_TOKEN` — ou
 * seja, já controla a instalação inteira. O que a condição impede é a rota
 * VIRAR superfície permanente de criação de conta, e isso ela impede.
 *
 * ## Workspace pessoal, na MESMA transação (RN-410)
 *
 * Toda conta nova nasce com o workspace pessoal, pela MESMA função dos outros
 * dois pontos de criação (`nomeESlugDoWorkspacePessoal`). Sem ele a instalação
 * fecharia com um login que atravessa e um dashboard onde "Novo projeto" não
 * tem onde criar — que é a metade do buraco que esta fase veio tapar, não a
 * outra. Este é o TERCEIRO ponto de criação de conta; ele não ganha uma regra
 * de nome/slug própria.
 *
 * ## O que NÃO acontece aqui
 *
 * Nenhum e-mail é enviado (não há para onde, e é o ponto). Nenhuma senha é
 * gerada: ela chega escolhida por um humano no TTY, e o caso de uso não tem
 * ramo que a invente. Nenhuma credencial de LLM é pedida — a chave que um
 * agente gasta é decisão de quem vai gastar (RN-058).
 */
@Injectable()
export class CriarPrimeiraContaUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly usuarios: UserRepository,
    private readonly provisionar: ProvisionarUsuarioUseCase,
    private readonly workspaces: WorkspaceRepository,
    private readonly eventos: AuthEventRecorder,
  ) {}

  async execute(entrada: {
    email: string;
    senha: string;
    nome?: string | null;
  }): Promise<PrimeiraContaCriada> {
    const emailNormalizado = normalizarEmail(entrada.email);

    // A MESMA régua do domínio, chamada pelo MESMO código (ADR 0155 ponto 3):
    // o instalador não carrega uma segunda política de senha, que divergiria
    // da do registro no primeiro dia em que uma das duas mudasse. Por isso o
    // DTO desta rota NÃO repete um `@MinLength`: a chamada abaixo cobre as
    // CINCO recusas da política, e não só o comprimento.
    //
    // O `catch` traduz, e não decide: `PoliticaDeSenhaError` é um `Error` de
    // domínio, sem filtro global que o mapeie, e sem esta linha uma senha que
    // a política recusa sairia 500 — o instalador leria "erro do servidor"
    // onde a resposta certa é "escolha outra senha". Traduzir aqui não toca o
    // registro normal, que fica byte a byte.
    try {
      exigirSenhaValida(entrada.senha, emailNormalizado);
    } catch (erro) {
      if (erro instanceof PoliticaDeSenhaError) {
        throw new BadRequestException(erro.message);
      }
      throw erro;
    }

    return this.unitOfWork.runInTransaction(async () => {
      if (await this.usuarios.existeAlgumUsuario()) {
        throw new ConflictException(
          'Esta instalação já tem usuário. A primeira conta só nasce numa ' +
            'instalação vazia — quem já tem conta entra pela tela de login, e ' +
            'quem não tem pede convite a quem tem.',
        );
      }

      // Reentrante: a transação aberta acima é reusada, e conta, credencial,
      // verificação e workspace entram num commit só. Um usuário sem
      // workspace seria uma conta que entra e não consegue fazer nada.
      const { user } = await this.provisionar.execute({
        email: emailNormalizado,
        nome: entrada.nome ?? null,
        senha: entrada.senha,
      });

      const { name, slug } = nomeESlugDoWorkspacePessoal(
        entrada.nome,
        emailNormalizado,
        user.id,
      );
      const workspace = await this.workspaces.create({
        name,
        slug,
        createdBy: user.id,
      });
      await this.workspaces.addMember(workspace.id, user.id, 'owner');

      await this.eventos.registrar({
        kind: 'first_account_created',
        subjectKey: assuntoDoUsuario(user.id),
        userId: user.id,
      });

      return { userId: user.id, email: user.email, workspaceId: workspace.id };
    });
  }
}
