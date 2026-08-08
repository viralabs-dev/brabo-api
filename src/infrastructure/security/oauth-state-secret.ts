/**
 * Resolve a chave HMAC que assina o `state` do OAuth de git.
 *
 * ## O que mudou e por quê
 *
 * Antes, os dois pontos de leitura faziam
 * `process.env.GIT_OAUTH_STATE_SECRET ?? 'dev-oauth-state-secret-change-me'` —
 * um default de desenvolvimento que valia igual em produção. É exatamente o
 * modo de falha que `cors-origins.ts` já fechou para o `WEB_ORIGIN`, e aqui ele
 * é pior: o valor não é só permissivo, é PÚBLICO. Está no `.env.example` deste
 * repositório, que é open source.
 *
 * O que essa chave protege é o `state` do fluxo de OAuth (`oauth-state.ts`), e
 * o `state` é o que impede o callback de ser forjado. Com a chave conhecida,
 * qualquer um assina um `state` válido para `{projectId, userId, provider}` à
 * escolha — e o callback então grava, no projeto apontado por ESSE payload, o
 * token de git obtido do provider. Ou seja: CSRF no fluxo de conexão, com
 * credencial de git como prêmio. Não é hipótese distante, porque o
 * `docker-compose.prod.yml` supria o literal como fallback: quem esquecesse a
 * variável subia produção assinando com a chave do exemplo.
 *
 * Por isso, em produção:
 *
 * - a variável é OBRIGATÓRIA. Sem ela o boot falha, como no `WEB_ORIGIN`: erro
 *   no start é barulhento e reversível; uma api que aceita `state` forjado é
 *   silenciosa e não é.
 * - o literal de desenvolvimento é REJEITADO mesmo quando explicitamente
 *   definido. Só exigir "não vazia" não resolveria nada aqui, justamente
 *   porque o caminho real de erro era um compose que a definia — com o valor
 *   errado.
 * - há um piso de tamanho. A tabela de configuração sempre disse "fraco = CSRF
 *   no fluxo de conexão de git"; isso transforma a frase em verificação. O piso
 *   é baixo de propósito: reprova `senha123`, e não opina sobre uma chave
 *   gerada por qualquer meio sério.
 *
 * Fora de produção o default continua valendo, porque `docker compose up` sem
 * `.env` tem que funcionar.
 *
 * A resolução mora AQUI, e não em cada caso de uso, pela mesma razão que fez
 * `projectScopeRoot()` existir (RN-092): as duas leituras têm que concordar, e
 * uma checagem duplicada é uma checagem que um dia diverge. Antes eram duas
 * cópias do mesmo literal, em arquivos diferentes.
 */
const DEFAULT_DEV_SECRET = 'dev-oauth-state-secret-change-me';
const TAMANHO_MINIMO = 16;

export function resolveOauthStateSecret(): string {
  const producao = process.env.NODE_ENV === 'production';
  const bruto = (process.env.GIT_OAUTH_STATE_SECRET ?? '').trim();

  if (!producao) {
    return bruto || DEFAULT_DEV_SECRET;
  }

  if (!bruto) {
    throw new Error(
      'GIT_OAUTH_STATE_SECRET é obrigatória em produção — ela assina o `state` do ' +
        'OAuth de git, e um default de desenvolvimento é público neste repositório: ' +
        'com ele qualquer um forja o callback.',
    );
  }

  if (bruto === DEFAULT_DEV_SECRET) {
    throw new Error(
      'GIT_OAUTH_STATE_SECRET está com o valor de exemplo do repositório, que é ' +
        'público — em produção isso equivale a não ter assinatura nenhuma no `state`. ' +
        'Gere uma chave própria (ex.: `openssl rand -base64 32`).',
    );
  }

  if (bruto.length < TAMANHO_MINIMO) {
    throw new Error(
      `GIT_OAUTH_STATE_SECRET tem ${bruto.length} caracteres; o mínimo em produção é ` +
        `${TAMANHO_MINIMO}. Ela é chave HMAC, não senha de humano: gere uma ` +
        'aleatória (ex.: `openssl rand -base64 32`).',
    );
  }

  return bruto;
}
