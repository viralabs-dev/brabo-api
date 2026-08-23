import { BadRequestException } from '@nestjs/common';
import type { ProjectExecutionMode } from '../../domain/iam/project.entity';
import {
  CaminhoLocalInvalidoError,
  caminhoDeWorkspaceLocalValido,
  normalizarSemBarraFinal,
  validarCaminhoDeWorkspaceLocal,
} from '../../infrastructure/filesystem/project-workspaces-root';

/**
 * O par (executionMode, workspacePath) validado — o valor que vai para a
 * coluna: `null` no modo `container`, o caminho validado (I/O) e normalizado
 * no modo `mounted`, o caminho normalizado só LEXICAMENTE (sem I/O) no modo
 * `runner`.
 *
 * Extraída de `CreateProjectUseCase` (RN-170/RN-422/RN-423) para
 * `ConvertProjectExecutionModeUseCase` (RN-447, ADR 0111) poder REUSAR a
 * mesma régua em vez de duplicá-la — a criação e a conversão validam
 * exatamente a mesma pergunta ("este (modo, caminho) é válido?"), só o
 * MOMENTO em que ela é feita muda.
 *
 * Caminho enviado junto com `container` é RECUSADO em vez de ignorado. Um
 * campo silenciosamente descartado é a semente de "mas eu configurei" — e o
 * CHECK do banco recusaria a linha de qualquer jeito; melhor um 400 que
 * explica do que um 500 vindo do Postgres.
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

  try {
    return validarCaminhoDeWorkspaceLocal(caminho);
  } catch (erro) {
    // 400 e não 500: quem digitou o caminho é o cliente, e a mensagem é a
    // parte útil da resposta — ela diz o que falta montar (RN-170).
    if (erro instanceof CaminhoLocalInvalidoError) {
      throw new BadRequestException(erro.message);
    }
    throw erro;
  }
}
