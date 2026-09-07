import { Injectable, NotFoundException } from '@nestjs/common';
import { MirrorStateRepository } from '../../ports/mirror-state-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  deriveMirrorSyncStatus,
  type MirrorSyncStatus,
} from '../../../domain/iam/mirror-state';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/** Teto da mensagem de erro gravada — o resto some, e a linha diz que sumiu. */
export const TETO_DA_MENSAGEM_DE_ERRO = 2000;

/** Teto de cada contagem — protege a coluna `integer` de um número absurdo. */
export const TETO_DE_CONTAGEM = 100_000_000;

/**
 * O que a api devolve ao engine — um ACK, não o estado inteiro. O engine não
 * decide nada com isto (ele só loga): o estado completo é lido pela TELA, por
 * `GET /projects/:projectId/mirror-state`. Devolver `status` mesmo assim é o
 * que deixa um teste de ponta a ponta provar, numa asserção só, que a rodada
 * gravada é a que passou a valer.
 */
export interface RecordMirrorSyncResult {
  recorded: true;
  status: MirrorSyncStatus;
}

export interface RecordMirrorSyncInput {
  /** O desfecho REAL da rodada, como o agente local o contou. */
  ok: boolean;
  /** O destino resolvido (sucesso) ou tentado (falha); `null` quando não há. */
  destination?: string | null;
  filesCopied?: number | null;
  filesSkipped?: number | null;
  filesRefused?: number | null;
  error?: string | null;
}

/**
 * Grava o desfecho de UMA rodada do espelho (RN-517, ADR 0147 ponto 7).
 *
 * Chamado só pelo engine, pelo HTTP interno, depois que o runner empurrou
 * `mirror_sync_result` no canal — o MESMO caminho de `workspace_confirm`
 * (runner → canal → engine → api), e nunca um segundo mecanismo: o engine não
 * escreve nesta tabela, ele reporta.
 *
 * ## Isto é telemetria, e telemetria não derruba o que mede
 *
 * A régua já escrita para `rag_searches` (RN-479..481) vale inteira aqui.
 * Nada neste caminho pode fazer a cópia falhar depois de ela ter funcionado:
 * o runner já terminou quando reporta, o `handle_in` do engine só loga a
 * recusa, e o único erro que este caso de uso levanta é o 404 de projeto
 * inexistente — que o engine também só loga.
 *
 * Nunca `session_events` (a rodada não tem sessão, e `session_id` é
 * `NOT NULL`) e nunca `proposed_action` (a escrita do espelho é configuração
 * que o usuário declarou, não um agente pedindo para agir).
 *
 * ## Um projeto que já não tem destino ainda registra
 *
 * Se alguém limpou `mirror_path` entre o disparo e o reporte, a rodada
 * ACONTECEU e o que ela achou continua sendo verdade — recusar aqui jogaria
 * fora justamente o erro que costuma explicar o que houve. A tela é quem
 * decide não mostrar a linha para projeto sem destino.
 *
 * ## O desfecho é o do runner, não uma inferência
 *
 * `ok` vem do outro lado. Este caso de uso não deduz sucesso de "veio
 * contagem" nem falha de "veio mensagem": deduzir faria uma rodada que copiou
 * 0 arquivos (perfeitamente normal) ser indistinguível de uma que nem rodou.
 */
@Injectable()
export class RecordMirrorSyncUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly mirrorStates: MirrorStateRepository,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    input: RecordMirrorSyncInput,
  ): Promise<RecordMirrorSyncResult> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const agora = new Date();

    if (input.ok) {
      const gravado = await this.mirrorStates.recordSuccess({
        projectId,
        // Destino ausente num sucesso não existe no protocolo, mas string
        // vazia gravada seria pior que a coluna dizer o que sabe.
        destination: (input.destination ?? '').trim(),
        filesCopied: contagem(input.filesCopied),
        filesSkipped: contagem(input.filesSkipped),
        filesRefused: contagem(input.filesRefused),
        syncedAt: agora,
      });
      return { recorded: true, status: deriveMirrorSyncStatus(gravado) };
    }

    const gravado = await this.mirrorStates.recordFailure({
      projectId,
      destination: destinoOuNulo(input.destination),
      error: mensagem(input.error),
      failedAt: agora,
    });
    return { recorded: true, status: deriveMirrorSyncStatus(gravado) };
  }
}

/** Nunca negativo, nunca `NaN`, nunca acima do teto — a coluna é `integer`. */
function contagem(valor: number | null | undefined): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return 0;
  return Math.min(Math.max(Math.trunc(valor), 0), TETO_DE_CONTAGEM);
}

function destinoOuNulo(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo.length > 0 ? limpo : null;
}

/**
 * Erro sem mensagem tem frase PRÓPRIA — nunca uma string vazia gravada, que
 * faria a tela dizer "falhou:" e parar no dois-pontos. E mensagem longa é
 * CORTADA dizendo que foi cortada, em vez de estourar a linha em silêncio
 * (a mesma disciplina de teto declarado da RN-180).
 */
function mensagem(valor: string | null | undefined): string {
  const bruto = typeof valor === 'string' ? valor.trim() : '';
  if (bruto.length === 0) {
    return 'O agente local reportou falha sem mensagem.';
  }
  if (bruto.length <= TETO_DA_MENSAGEM_DE_ERRO) return bruto;
  return `${bruto.slice(0, TETO_DA_MENSAGEM_DE_ERRO)}… (mensagem cortada)`;
}
