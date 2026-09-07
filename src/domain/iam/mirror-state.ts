/**
 * O ESTADO da última rodada do espelho de um projeto (RN-517, ADR 0147
 * ponto 7) — a telemetria que o agente local empurra no canal depois de
 * copiar o trabalho para a pasta do usuário.
 *
 * Regra pura, aqui e não na tela nem no repositório, porque ela é a decisão
 * que a RN-088 pede: **"nunca olhei" nunca colapsa em "olhei e não achei
 * nada"**. São TRÊS respostas diferentes, e um traço que serve às três é a
 * tela recusando nomear o que sabe (RN-470).
 */

/** O destino da última rodada e o que aconteceu nela. */
export interface ProjectMirrorState {
  projectId: string;
  /** Última sincronização BEM-SUCEDIDA. `null` = nenhuma até hoje. */
  lastSyncedAt: Date | null;
  /** Contagens daquela rodada bem-sucedida. `0` é número, não vazio. */
  filesCopied: number | null;
  filesSkipped: number | null;
  filesRefused: number | null;
  /** O destino REAL daquela rodada, congelado na linha. */
  destination: string | null;
  /** Último erro reportado — nunca apaga, e nunca é apagado por, o sucesso. */
  lastErrorAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

/**
 * - `never` — nenhum runner reportou rodada nenhuma (a linha nem existe).
 * - `synced` — a última rodada COPIOU (com `filesCopied` podendo ser `0`,
 *   que é "olhei e não havia nada a copiar", e tem frase própria na tela).
 * - `failed` — a última rodada FALHOU, e o erro é mais recente que o último
 *   sucesso.
 */
export type MirrorSyncStatus = 'never' | 'synced' | 'failed';

/**
 * Qual dos dois carimbos está VIGENTE.
 *
 * Comparar as datas em vez de limpar uma coluna com a outra é o que permite a
 * tela mostrar, ao mesmo tempo, "está falhando desde ontem" e "a última cópia
 * que funcionou foi anteontem, com 412 arquivos" — a informação mais útil que
 * ela tem, e a que uma escrita destrutiva teria jogado fora.
 *
 * Empate (o mesmo instante nos dois, que só um relógio de baixa resolução
 * produz) resolve para `failed`: entre afirmar que está tudo bem e afirmar que
 * algo falhou, a afirmação segura é a que faz a pessoa olhar.
 */
export function deriveMirrorSyncStatus(
  state: ProjectMirrorState | null,
): MirrorSyncStatus {
  if (!state) return 'never';
  const sucesso = state.lastSyncedAt?.getTime() ?? null;
  const falha = state.lastErrorAt?.getTime() ?? null;

  if (falha !== null && (sucesso === null || falha >= sucesso)) return 'failed';
  if (sucesso !== null) return 'synced';
  // Linha sem carimbo nenhum: não deveria existir (todo caminho de escrita
  // grava um dos dois), e mesmo assim ela NÃO vira `synced` por omissão —
  // afirmar uma sincronização que ninguém reportou é o colapso que a RN-088
  // recusa.
  return 'never';
}
