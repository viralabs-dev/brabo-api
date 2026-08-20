import { afterEach, describe, expect, it } from 'vitest';
import { resolverConfigNeo4j } from '../../../src/infrastructure/graph/neo4j-config';

/**
 * Fundação do grafo de conhecimento (Neo4j) — o toggle é mais SIMPLES que o
 * do `MAIL_TRANSPORT`: aqui não há variável de modo separada, a AUSÊNCIA das
 * três variáveis já é o desligamento. Em produção, falta de qualquer uma
 * derruba o boot; fora dela, ausência (total ou parcial) é um estado válido
 * — ver o comentário em `neo4j-config.ts`.
 */

const ENV_ORIGINAIS = { ...process.env };

function limpar() {
  delete process.env.NODE_ENV;
  delete process.env.NEO4J_URI;
  delete process.env.NEO4J_USER;
  delete process.env.NEO4J_PASSWORD;
}

afterEach(() => {
  process.env = { ...ENV_ORIGINAIS };
});

describe('resolverConfigNeo4j', () => {
  afterEach(limpar);

  it('fora de produção, sem NENHUMA variável, devolve null (grafo desligado)', () => {
    limpar();
    process.env.NODE_ENV = 'development';
    expect(resolverConfigNeo4j()).toBeNull();
  });

  it('fora de produção, configuração PARCIAL também devolve null', () => {
    limpar();
    process.env.NODE_ENV = 'test';
    process.env.NEO4J_URI = 'bolt://localhost:7687';
    expect(resolverConfigNeo4j()).toBeNull();
  });

  it('fora de produção, com as três variáveis, devolve a config', () => {
    limpar();
    process.env.NODE_ENV = 'development';
    process.env.NEO4J_URI = 'bolt://localhost:7687';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'senha-de-teste';
    expect(resolverConfigNeo4j()).toEqual({
      uri: 'bolt://localhost:7687',
      user: 'neo4j',
      password: 'senha-de-teste',
    });
  });

  it('em produção, com as três variáveis, devolve a config', () => {
    limpar();
    process.env.NODE_ENV = 'production';
    process.env.NEO4J_URI = 'bolt://neo4j:7687';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'senha-real';
    expect(resolverConfigNeo4j()).toEqual({
      uri: 'bolt://neo4j:7687',
      user: 'neo4j',
      password: 'senha-real',
    });
  });

  it('em produção, sem NEO4J_URI, derruba o boot', () => {
    limpar();
    process.env.NODE_ENV = 'production';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'senha-real';
    expect(() => resolverConfigNeo4j()).toThrow(/NEO4J_URI.*obrigatória/i);
  });

  it('em produção, sem NEO4J_USER, derruba o boot', () => {
    limpar();
    process.env.NODE_ENV = 'production';
    process.env.NEO4J_URI = 'bolt://neo4j:7687';
    process.env.NEO4J_PASSWORD = 'senha-real';
    expect(() => resolverConfigNeo4j()).toThrow(/NEO4J_USER.*obrigatória/i);
  });

  it('em produção, sem NEO4J_PASSWORD, derruba o boot', () => {
    limpar();
    process.env.NODE_ENV = 'production';
    process.env.NEO4J_URI = 'bolt://neo4j:7687';
    process.env.NEO4J_USER = 'neo4j';
    expect(() => resolverConfigNeo4j()).toThrow(/NEO4J_PASSWORD.*obrigatória/i);
  });

  it('em produção, espaço em volta não conta como configurado', () => {
    limpar();
    process.env.NODE_ENV = 'production';
    process.env.NEO4J_URI = '   ';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'senha-real';
    expect(() => resolverConfigNeo4j()).toThrow(/NEO4J_URI.*obrigatória/i);
  });
});
