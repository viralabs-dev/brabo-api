import { describe, it, expect, afterEach } from 'vitest';
import {
  tokenDeServicoAtual,
  tokenDeServicoConfere,
} from '../../../src/infrastructure/security/service-token';

/**
 * Segredo compartilhado do tráfego interno api <-> engine (RN-114, mesmo
 * padrão do `GIT_OAUTH_STATE_SECRET` — ADR 0059/RN-093).
 *
 * Mesma observação de `oauth-state-secret.spec.ts`: o caso que interessa não
 * é o feliz, é o de subir produção sem configurar. O default é público neste
 * repositório (`.env.example`), e o `docker-compose.prod.yml` o supria como
 * fallback — por isso o teste central não é "falha quando falta", é "falha
 * quando está DEFINIDA com o valor de exemplo".
 */

// Fixture DELIBERADAMENTE sem entropia — ver a mesma nota em
// oauth-state-secret.spec.ts sobre o Gitleaks recusar valor de alta entropia
// atribuído a uma env var de segredo.
const TOKEN_DE_TESTE = 'token-de-teste-nao-e-segredo';

describe('tokenDeServicoAtual', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.BRABO_SERVICE_TOKEN;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  it('caminho feliz: em produção, devolve o token configurado', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = TOKEN_DE_TESTE;
    expect(tokenDeServicoAtual()).toBe(TOKEN_DE_TESTE);
  });

  it('em produção, o token de EXEMPLO do repositório derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = 'dev-service-token-change-me';
    expect(() => tokenDeServicoAtual()).toThrow(/valor de exemplo/i);
  });

  it('em produção, sem a variável, derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    expect(() => tokenDeServicoAtual()).toThrow(/obrigatória em produção/i);
  });

  it('em produção, token curto derruba o boot', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = 'senha123';
    expect(() => tokenDeServicoAtual()).toThrow(/mínimo em produção/i);
  });

  it('em produção, espaço em volta não conta como token', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = '   ';
    expect(() => tokenDeServicoAtual()).toThrow(/obrigatória em produção/i);
  });

  it('fora de produção, sem a variável, cai no default de desenvolvimento', () => {
    process.env.NODE_ENV = 'development';
    expect(tokenDeServicoAtual()).toBe('dev-service-token-change-me');
  });

  it('fora de produção, token curto é aceito', () => {
    process.env.NODE_ENV = 'development';
    process.env.BRABO_SERVICE_TOKEN = 'curto';
    expect(tokenDeServicoAtual()).toBe('curto');
  });
});

/**
 * A rotação do runbook (`docs/runbook.md`, "BRABO_SERVICE_TOKEN —
 * zero-downtime rotation", RN-597), passo a passo. O que cada passo promete é
 * uma afirmação sobre ESTAS duas funções: quem VERIFICA aceita o atual e o
 * anterior, quem CHAMA manda sempre o atual. É a combinação das duas que deixa
 * pod velho e pod novo conversarem no meio do rollout — testar só uma delas
 * provaria metade da janela.
 */
describe('rotação do BRABO_SERVICE_TOKEN (runbook, RN-597)', () => {
  const nodeEnvOriginal = process.env.NODE_ENV;
  // Sem entropia de propósito, pela mesma nota do topo (Gitleaks).
  const VELHO = 'token-velho-de-teste-nao-e-segredo';
  const NOVO = 'token-novo-de-teste-nao-e-segredo';

  afterEach(() => {
    delete process.env.BRABO_SERVICE_TOKEN;
    delete process.env.BRABO_SERVICE_TOKEN_PREVIOUS;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
  });

  function antesDaRotacao() {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = VELHO;
    delete process.env.BRABO_SERVICE_TOKEN_PREVIOUS;
  }

  function passo1() {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = NOVO;
    process.env.BRABO_SERVICE_TOKEN_PREVIOUS = VELHO;
  }

  function passo3() {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = NOVO;
    delete process.env.BRABO_SERVICE_TOKEN_PREVIOUS;
  }

  it('antes da rotação: só o token vigente passa', () => {
    antesDaRotacao();
    expect(tokenDeServicoConfere(VELHO)).toBe(true);
    expect(tokenDeServicoConfere(NOVO)).toBe(false);
  });

  it('passo 1: o pod NOVO aceita o que um pod VELHO manda (o anterior)', () => {
    passo1();
    expect(tokenDeServicoConfere(VELHO)).toBe(true);
  });

  it('passo 1: o pod NOVO aceita o que outro pod NOVO manda (o atual)', () => {
    passo1();
    expect(tokenDeServicoConfere(NOVO)).toBe(true);
  });

  it('passo 1: quem CHAMA manda o atual, nunca o anterior', () => {
    // É esta metade que torna a ordem de rollout indiferente: se o pod novo
    // mandasse o anterior, o passo 3 recusaria o próprio pod. Os três
    // clientes (`api-to-engine-client`, `container-broker.client`,
    // `session-channel-notifier`) põem no cabeçalho `tokenDeServicoAtual()`.
    passo1();
    expect(tokenDeServicoAtual()).toBe(NOVO);
  });

  it('passo 1: o anterior não abre a porta para um terceiro valor', () => {
    passo1();
    expect(tokenDeServicoConfere('token-qualquer-de-teste-nao-e-segredo')).toBe(
      false,
    );
    expect(tokenDeServicoConfere('')).toBe(false);
  });

  it('o passo 2 depende do passo 1: pod que ainda NÃO tem o PREVIOUS recusa o token novo', () => {
    // Um pod velho verifica só contra o VELHO: o NOVO chega nele recusado.
    // A janela só é segura porque o passo 1 põe o PREVIOUS nos DOIS lados
    // antes de qualquer pod novo existir — o runbook chama o atalho
    // ("só trocar o valor atual") de 403/401 na janela inteira.
    antesDaRotacao();
    expect(tokenDeServicoConfere(NOVO)).toBe(false);
  });

  it('passo 3: sem o PREVIOUS, o token velho deixa de passar', () => {
    passo3();
    expect(tokenDeServicoConfere(VELHO)).toBe(false);
    expect(tokenDeServicoConfere(NOVO)).toBe(true);
  });

  it('PREVIOUS igual ao atual não conta como rotação, e não muda o que passa', () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_SERVICE_TOKEN = NOVO;
    process.env.BRABO_SERVICE_TOKEN_PREVIOUS = NOVO;
    expect(tokenDeServicoConfere(NOVO)).toBe(true);
    expect(tokenDeServicoConfere(VELHO)).toBe(false);
  });
});
