import { BadRequestException } from '@nestjs/common';
import type { ProjectExecutionMode } from '../../domain/iam/project.entity';
import {
  caminhoDeWorkspaceLocalValido,
  dentroDaBaseDeProjetos,
  motivoDeForaDaBaseDeProjetos,
  normalizarSemBarraFinal,
} from '../../infrastructure/filesystem/project-workspaces-root';

/**
 * O par (executionMode, workspacePath) validado — o valor que vai para a
 * coluna: `null` no modo `container`, o caminho normalizado só LEXICAMENTE
 * (sem I/O) nos modos `mounted` e `runner`, com `mounted` acrescentando a
 * exigência de estar dentro de `BRABO_PROJECTS_BASE`.
 *
 * Extraída de `CreateProjectUseCase` (RN-170/RN-422/RN-423) para
 * `ConvertProjectExecutionModeUseCase` (RN-447, ADR 0111) poder REUSAR a
 * mesma régua em vez de duplicá-la — a criação e a conversão validam
 * exatamente a mesma pergunta ("este (modo, caminho) é válido?"), só o
 * MOMENTO em que ela é feita muda.
 *
 * ## `mounted` não toca mais DISCO aqui (ADR 0142, RN-501)
 *
 * Até a RN-500 este ramo chamava `validarCaminhoDeWorkspaceLocal`, que exigia
 * a pasta EXISTINDO e GRAVÁVEL de dentro do container da api no instante da
 * criação. Isso tornava impossível o requisito do dono do produto — *"se for
 * Pasta montada, o bind-mount deve ser criado APÓS a decisão do Arquiteto"* —,
 * porque a criação recusava muito antes de haver decisão nenhuma.
 *
 * O que entrou no lugar é a MESMA disciplina que `runner` já tinha (RN-423):
 * léxico agora, disco depois, por quem tem autoridade para responder. A
 * diferença entre os dois modos continua sendo QUANDO/QUEM confirma o disco —
 * no `runner` é o CLI conectando; no `mounted` é `materializarWorkspaceMontado`
 * (a conversão, e a subida do container pela Infra).
 *
 * E entrou UMA regra nova, que só o `mounted` tem: o caminho precisa estar
 * dentro de `BRABO_PROJECTS_BASE` (ADR 0141). Não é rigor extra — é a única
 * pasta que os containers da api e do engine enxergam, então um caminho fora
 * dela produz exatamente o projeto que trava depois que esta validação existe
 * para impedir. Sem base configurada, o modo não está disponível nesta
 * instalação, e a recusa DIZ isso em vez de fingir que o caminho é que estava
 * errado.
 *
 * Caminho enviado junto com `container` é RECUSADO em vez de ignorado. Um
 * campo silenciosamente descartado é a semente de "mas eu configurei" — e o
 * CHECK do banco recusaria a linha de qualquer jeito; melhor um 400 que
 * explica do que um 500 vindo do Postgres. O CHECK, aliás, não muda com nada
 * disto: `mounted` continua gravando `workspace_path` NÃO-nulo, e adiar a
 * VERIFICAÇÃO nunca toca o invariante de PAREAMENTO.
 */
export function validarExecutionModeEWorkspacePath(
  executionMode: ProjectExecutionMode,
  workspacePathInput: string | null | undefined,
): string | null {
  const caminho = workspacePathInput?.trim();

  if (executionMode === 'container') {
    if (caminho) {
      throw new BadRequestException(
        'workspacePath só vale para projeto nos modos "mounted"/"runner". ' +
          'No modo "container" a pasta é gerenciada pelo produto, dentro ' +
          'de PROJECT_WORKSPACES_ROOT.',
      );
    }
    return null;
  }

  if (!caminho) {
    throw new BadRequestException(
      `Projeto no modo "${executionMode}" precisa de workspacePath: o caminho ` +
        'absoluto da pasta do seu computador onde o código vai morar.',
    );
  }

  if (executionMode === 'runner') {
    if (!caminhoDeWorkspaceLocalValido(caminho)) {
      throw new BadRequestException(
        `Caminho inválido para um projeto "runner": ${JSON.stringify(caminho)}. ` +
          'Ele precisa ser absoluto (começar com "/"), sem ".." no meio, e ' +
          'não pode ser a raiz do sistema nem se sobrepor ao checkout do ' +
          'próprio Brabo. O disco só é verificado quando o runner conectar ' +
          '— rode "brabo-runner --project <id> --dir <pasta>" depois de ' +
          'criar o projeto.',
      );
    }
    // Mesma normalização que o léxico usa — o valor GRAVADO é o
    // normalizado, nunca a string crua que chegou (mesmo motivo de
    // `mounted` abaixo).
    return normalizarSemBarraFinal(caminho);
  }

  // `mounted`: léxico + base, sem I/O nenhum (ADR 0142, RN-501).
  if (!caminhoDeWorkspaceLocalValido(caminho)) {
    throw new BadRequestException(
      `Caminho inválido para um projeto "mounted": ${JSON.stringify(caminho)}. ` +
        'Ele precisa ser absoluto (começar com "/"), sem ".." no meio, e ' +
        'não pode ser a raiz do sistema, uma pasta de sistema nem se ' +
        'sobrepor ao checkout do próprio Brabo (ADR 0055).',
    );
  }

  const normalizado = normalizarSemBarraFinal(caminho);

  // A mensagem vem da MESMA fonte que a materialização usa: as duas portas
  // recusam pelo mesmo motivo, e duas redações divergiriam no dia em que a
  // base ganhar outra forma. Ela cobre os DOIS casos — fora da base, e base
  // não configurada (o modo não está disponível nesta instalação).
  if (!dentroDaBaseDeProjetos(normalizado)) {
    throw new BadRequestException(motivoDeForaDaBaseDeProjetos(normalizado));
  }

  // Mesma normalização de `runner`: o valor GRAVADO é o normalizado, nunca a
  // string crua que chegou.
  return normalizado;
}
