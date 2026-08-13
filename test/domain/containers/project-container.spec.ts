import { describe, expect, it } from 'vitest';
import {
  ImagemInvalidaError,
  RECURSOS_MAXIMOS,
  RECURSOS_PADRAO,
  referenciaDeImagemValida,
  validarDecisaoDeImagem,
} from '../../../src/domain/containers/project-container';

const RATIONALE = 'stack TypeScript sobre Node 22, e a slim basta';

describe('referenciaDeImagemValida', () => {
  it.each([
    'node:22-bookworm-slim',
    'python:3.12-slim',
    'ghcr.io/acme/base:1.4.2',
    'registry.local:5000/acme/base:1.0',
    'node@sha256:0123456789abcdef',
  ])('aceita %s', (ref) => {
    expect(referenciaDeImagemValida(ref)).toBe(true);
  });

  it.each([
    ['', 'vazia'],
    ['node', 'sem tag: o nome não determina a imagem'],
    ['node:latest', '`latest` é o mesmo que não ter tag'],
    ['registry.local:5000/acme/base', 'os dois-pontos ali são de PORTA'],
    ['node:22; rm -rf /', 'metacaractere de shell'],
    ['node:22 && curl x', 'espaço e encadeamento'],
    ['node:$(cat /etc/passwd)', 'substituição de comando'],
  ])('recusa %j — %s', (ref) => {
    expect(referenciaDeImagemValida(ref)).toBe(false);
  });
});

describe('validarDecisaoDeImagem', () => {
  it('caminho feliz: normaliza e aplica os defaults', () => {
    const d = validarDecisaoDeImagem({
      image: '  node:22-bookworm-slim  ',
      rationale: RATIONALE,
    });

    expect(d.image).toBe('node:22-bookworm-slim');
    // `none` é o default, e é o que torna "dentro o agente é livre" seguro.
    expect(d.network).toBe('none');
    expect(d.resources).toEqual(RECURSOS_PADRAO);
  });

  it('`latest` é recusado com a razão escrita, para o modelo corrigir', () => {
    expect(() =>
      validarDecisaoDeImagem({ image: 'node:latest', rationale: RATIONALE }),
    ).toThrow(/daqui a seis meses/);
  });

  it('sem `rationale` não há artefato revisável', () => {
    expect(() =>
      validarDecisaoDeImagem({ image: 'node:22-slim', rationale: 'pq sim' }),
    ).toThrow(ImagemInvalidaError);
  });

  it('`network` fora de {none, egress} é recusada', () => {
    expect(() =>
      validarDecisaoDeImagem({
        image: 'node:22-slim',
        rationale: RATIONALE,
        network: 'host',
      }),
    ).toThrow(/network inválida/);
  });

  it('`egress` é aceito — é pedido legítimo, com dono declarado', () => {
    const d = validarDecisaoDeImagem({
      image: 'node:22-slim',
      rationale: RATIONALE,
      network: 'egress',
    });
    expect(d.network).toBe('egress');
  });

  it('recurso acima do teto é RECUSADO, nunca rebaixado em silêncio', () => {
    expect(() =>
      validarDecisaoDeImagem({
        image: 'node:22-slim',
        rationale: RATIONALE,
        resources: { memoryMb: RECURSOS_MAXIMOS.memoryMb + 1 },
      }),
    ).toThrow(/passa do teto/);
  });

  it('recurso parcial completa com o default, sem inventar teto', () => {
    const d = validarDecisaoDeImagem({
      image: 'node:22-slim',
      rationale: RATIONALE,
      resources: { cpus: 1 },
    });
    expect(d.resources).toEqual({ ...RECURSOS_PADRAO, cpus: 1 });
  });

  it.each([0, -1, 'muito'])('recurso %j não é número positivo', (valor) => {
    expect(() =>
      validarDecisaoDeImagem({
        image: 'node:22-slim',
        rationale: RATIONALE,
        resources: { cpus: valor },
      }),
    ).toThrow(ImagemInvalidaError);
  });
});
