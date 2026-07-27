import { comparaEmTempoConstante } from './auth-key-material';

/**
 * Segredo compartilhado do tráfego interno engine ↔ api (Fase 7a, item 4).
 *
 * ## Um segredo, nos dois sentidos
 *
 * O mesmo valor autentica engine→api e api→engine. Dois segredos separados
 * limitariam o estrago de um vazamento a um sentido só — mas as duas pontas
 * rodam no mesmo cluster, são implantadas juntas e leem o mesmo Secret; quem
 * consegue ler um lê o outro. O segundo segredo daria a impressão de
 * compartimentar sem compartimentar nada, ao custo de dobrar o que precisa
 * ser rotacionado em sincronia.
 *
 * ## Rotação
 *
 * `BRABO_SERVICE_TOKEN_PREVIOUS` é aceito só na VERIFICAÇÃO; quem chama sempre
 * manda o atual. Assim as duas pontas podem ser atualizadas em qualquer ordem,
 * sem janela em que uma recusa a outra. É a mesma dança de três etapas do
 * `AUTH_JWT_SECRET` e do `CREDENTIALS_MASTER_KEY`, e o runbook trata as três
 * no mesmo lugar.
 */
const PADRAO_DEV = 'dev-service-token-change-me';

export function tokenDeServicoAtual(): string {
  return process.env.BRABO_SERVICE_TOKEN ?? PADRAO_DEV;
}

function tokenDeServicoAnterior(): string | null {
  const anterior = process.env.BRABO_SERVICE_TOKEN_PREVIOUS;
  if (!anterior || anterior === tokenDeServicoAtual()) return null;
  return anterior;
}

/**
 * Confere o token apresentado contra o atual e, se houver, o anterior.
 *
 * Comparação em tempo constante nos dois casos. Um `===` aqui vazaria o
 * segredo byte a byte para quem medisse o tempo de resposta — e esta é uma
 * rota que aceita chamadas repetidas sem custo, que é justamente a condição
 * que torna esse ataque prático.
 */
export function tokenDeServicoConfere(apresentado: string): boolean {
  if (comparaEmTempoConstante(apresentado, tokenDeServicoAtual())) return true;

  const anterior = tokenDeServicoAnterior();
  return anterior !== null && comparaEmTempoConstante(apresentado, anterior);
}
