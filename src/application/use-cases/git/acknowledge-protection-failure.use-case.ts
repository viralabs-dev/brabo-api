import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { deriveProvisioningStatus } from '../../../domain/git/repo-bootstrap-status';

/**
 * "Sei que as branches não ficaram protegidas, e quero seguir" (achado D).
 *
 * ## O beco sem saída que isto abre
 *
 * `protect_branches` falha em repositório privado no plano gratuito do GitHub —
 * e o wizard AVISA isso antes de começar. Mas o único botão oferecido depois da
 * falha era "Tentar novamente", que vai falhar sempre pelo mesmo motivo.
 *
 * Pior que a tela sem saída: `provision_failed` faz o dashboard redirecionar o
 * clique do projeto de volta para a página de provisionamento. O projeto ficava
 * **inalcançável para sempre**, preso num passo que não tem como suceder.
 *
 * ## Por que só `protect_branches`
 *
 * É o ÚLTIMO passo, e o único cuja falha deixa um repositório utilizável: o
 * repo existe, os arquivos foram commitados, as branches foram criadas. Falhar
 * em criar o repositório ou em commitar é outra coisa — ali "seguir" produziria
 * um projeto que não tem onde trabalhar, e o botão seria uma segunda mentira.
 *
 * Como é o último passo, marcá-lo `done` basta: `deriveProvisioningStatus` já
 * devolve `provisioned` quando o último passo está feito. Não há o que retomar.
 *
 * ## O que NÃO muda
 *
 * A trava de merge do produto ([RN-006](../../../../docs/business-rules.md#rn-006))
 * é aplicada em `decide.ts`, não pela proteção do provider. Seguir sem ela não
 * remove a garantia do Brabo — remove a do GitHub, que é uma segunda camada.
 * É por isso que esta saída é honesta, e não um atalho.
 */
@Injectable()
export class AcknowledgeProtectionFailureUseCase {
  constructor(
    private readonly repoBootstraps: RepoBootstrapRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, userId: string) {
    const bootstrap = await this.repoBootstraps.findByProjectId(projectId);
    if (!bootstrap) {
      throw new NotFoundException(
        `Projeto sem bootstrap de repositório: ${projectId}`,
      );
    }

    if (bootstrap.status !== 'failed') {
      throw new ConflictException(
        'Só há o que reconhecer quando o bootstrap falhou',
      );
    }

    if (bootstrap.step !== 'protect_branches') {
      // A mensagem diz POR QUE não dá, em vez de só recusar: falhar antes da
      // proteção deixa um repositório sem onde trabalhar.
      throw new ConflictException(
        `Só a falha em proteger as branches pode ser reconhecida — ` +
          `"${bootstrap.step}" falhou antes disso, e seguir deixaria o projeto ` +
          `sem repositório utilizável`,
      );
    }

    // A DECISÃO no event log, com quem decidiu — mesmo princípio da aprovação
    // de ação (achado #17). O ator é o usuário, não o bootstrap: seguir sem
    // proteção é escolha dele, e o `lastError` fica junto para quem for ler
    // depois saber o que exatamente foi dispensado.
    await this.appendSessionEvent.execute(projectId, bootstrap.sessionId, {
      type: 'bootstrap.step_acknowledged',
      actor: { kind: 'user', id: userId },
      payload: {
        step: bootstrap.step,
        reason: 'user_acknowledged',
        lastError: bootstrap.lastError,
      },
    });

    const atualizado = await this.repoBootstraps.update(projectId, {
      step: bootstrap.step,
      status: 'done',
      attempts: bootstrap.attempts,
      lastError: bootstrap.lastError,
    });

    return { status: deriveProvisioningStatus(atualizado) };
  }
}
