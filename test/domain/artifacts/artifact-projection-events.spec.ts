import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_PROJECTABLE_EVENT_TYPES,
  ARTIFACT_PROJECTION_AGGREGATE_TYPE,
  TIPOS_DE_ARTEFATO_VERSIONADOS,
  nomeDeArquivoDoArtefato,
  pastaDoAgente,
  slugDeArquivo,
  tipoSemPrefixo,
  tituloDoArtefato,
} from '../../../src/domain/artifacts/artifact-projection-events';

/**
 * As regras de nome da projeção (ADR 0148, RN-523).
 *
 * O nome do arquivo é derivado de payload de LLM, então este spec é a primeira
 * das duas barreiras contra o filesystem — a segunda é a checagem de
 * `relative()` em `FsArtifactFileStore`. O que se prova aqui é que a derivação
 * usa um alfabeto FECHADO: nenhum caminho de retorno pode conter separador.
 */
describe('slugDeArquivo', () => {
  it('normaliza acento, caixa e espaço', () => {
    expect(slugDeArquivo('Cache de Sessão')).toBe('cache-de-sessao');
    expect(slugDeArquivo('  Título  com   espaços ')).toBe('titulo-com-espacos');
  });

  it('não deixa separador de caminho sobreviver — nem `..`', () => {
    expect(slugDeArquivo('../../etc/passwd')).toBe('etc-passwd');
    expect(slugDeArquivo('/absoluto/demais')).toBe('absoluto-demais');
    expect(slugDeArquivo('..')).toBeNull();
    expect(slugDeArquivo('../..')).toBeNull();
    expect(slugDeArquivo('c:\\windows\\system32')).toBe('c-windows-system32');
  });

  it('descarta o que não é alfanumérico, inclusive NUL e emoji', () => {
    expect(slugDeArquivo('nome\u0000nulo')).toBe('nome-nulo');
    expect(slugDeArquivo('deploy 🚀 agora')).toBe('deploy-agora');
  });

  it('trunca sem deixar hífen solto no fim', () => {
    const longo = slugDeArquivo('a'.repeat(200));
    expect(longo).toHaveLength(60);
    expect(longo?.endsWith('-')).toBe(false);
  });

  it('devolve null quando não sobra nada — nome vazio colidiria com todos', () => {
    expect(slugDeArquivo('')).toBeNull();
    expect(slugDeArquivo('   ')).toBeNull();
    expect(slugDeArquivo('///')).toBeNull();
    expect(slugDeArquivo('🚀')).toBeNull();
  });
});

describe('pastaDoAgente', () => {
  it('usa o id do ator como pasta', () => {
    expect(pastaDoAgente('arquiteto')).toBe('arquiteto');
    expect(pastaDoAgente('dev-checkout')).toBe('dev-checkout');
    expect(pastaDoAgente('qa-lead')).toBe('qa-lead');
  });

  it('ator estranho vira pasta VISÍVEL, nunca caminho inventado', () => {
    expect(pastaDoAgente('../../root')).toBe('root');
    expect(pastaDoAgente('')).toBe('agente-desconhecido');
    expect(pastaDoAgente('///')).toBe('agente-desconhecido');
  });
});

describe('nomeDeArquivoDoArtefato', () => {
  it('versionado é o próprio tipo — sobrescreve, mostrando o vigente', () => {
    for (const tipo of TIPOS_DE_ARTEFATO_VERSIONADOS) {
      const nome = nomeDeArquivoDoArtefato({
        eventType: tipo,
        seq: 1,
        titulo: 'ignorado de propósito',
      });
      expect(nome).toBe(`${tipoSemPrefixo(tipo)}.md`);
    }
  });

  it('versionado não muda de nome com o seq — senão a pasta acumularia versões', () => {
    const a = nomeDeArquivoDoArtefato({ eventType: 'artifact.c4_diagram', seq: 1 });
    const b = nomeDeArquivoDoArtefato({ eventType: 'artifact.c4_diagram', seq: 99 });
    expect(a).toBe(b);
  });

  it('append-only leva tipo, título e o seq como desempate', () => {
    expect(
      nomeDeArquivoDoArtefato({
        eventType: 'artifact.decision_record',
        seq: 12,
        titulo: 'Cache de sessão',
      }),
    ).toBe('decision_record-cache-de-sessao-12.md');
  });

  // Sem o `seq`, dois artefatos do mesmo tipo com o mesmo título gerariam o
  // mesmo arquivo e o segundo apagaria o primeiro — a única forma de esta
  // projeção PERDER informação que a fonte tem.
  it('mesmo tipo e mesmo título em seqs diferentes não colidem', () => {
    const a = nomeDeArquivoDoArtefato({
      eventType: 'artifact.note',
      seq: 4,
      titulo: 'Reunião',
    });
    const b = nomeDeArquivoDoArtefato({
      eventType: 'artifact.note',
      seq: 5,
      titulo: 'Reunião',
    });
    expect(a).not.toBe(b);
  });

  it('sem título utilizável cai em `<tipo>-<seq>` — feio e verdadeiro', () => {
    expect(
      nomeDeArquivoDoArtefato({ eventType: 'artifact.insight', seq: 8, titulo: null }),
    ).toBe('insight-8.md');
    expect(
      nomeDeArquivoDoArtefato({ eventType: 'artifact.insight', seq: 8, titulo: '🚀' }),
    ).toBe('insight-8.md');
  });

  it('título hostil não escapa da pasta', () => {
    const nome = nomeDeArquivoDoArtefato({
      eventType: 'artifact.note',
      seq: 1,
      titulo: '../../../etc/passwd',
    });
    expect(nome).not.toContain('/');
    expect(nome).not.toContain('..');
  });
});

describe('tituloDoArtefato', () => {
  it('tenta os campos conhecidos, na ordem', () => {
    expect(tituloDoArtefato({ title: 'A' })).toBe('A');
    expect(tituloDoArtefato({ choice: 'B' })).toBe('B');
    expect(tituloDoArtefato({ resumo: 'C' })).toBe('C');
    expect(tituloDoArtefato({ storyId: 'D' })).toBe('D');
    // `title` vence `choice` quando os dois existem.
    expect(tituloDoArtefato({ title: 'A', choice: 'B' })).toBe('A');
  });

  it('payload sem campo conhecido, vazio ou não-objeto devolve null', () => {
    expect(tituloDoArtefato({ outro: 'x' })).toBeNull();
    expect(tituloDoArtefato({ title: '   ' })).toBeNull();
    expect(tituloDoArtefato(null)).toBeNull();
    expect(tituloDoArtefato('string')).toBeNull();
  });
});

describe('o vocabulário', () => {
  it('não drena o aggregate_type do grafo nem os do engine', () => {
    // `Engine.Outbox.Drain` só lê `session`, `task` e `container`; o grafo lê
    // `graph_projection`. Colidir com qualquer um faria as duas projeções
    // correrem pela mesma linha, e uma perderia.
    expect(ARTIFACT_PROJECTION_AGGREGATE_TYPE).not.toBe('session');
    expect(ARTIFACT_PROJECTION_AGGREGATE_TYPE).not.toBe('task');
    expect(ARTIFACT_PROJECTION_AGGREGATE_TYPE).not.toBe('container');
    expect(ARTIFACT_PROJECTION_AGGREGATE_TYPE).not.toBe('graph_projection');
  });

  it('todo tipo projetável é `artifact.*`', () => {
    for (const tipo of ARTIFACT_PROJECTABLE_EVENT_TYPES) {
      expect(tipo.startsWith('artifact.')).toBe(true);
    }
  });

  it('os quatro desfechos OPERACIONAIS ficam de fora, por decisão', () => {
    for (const fora of [
      'artifact.qa_verdict',
      'artifact.secops_verdict',
      'artifact.task_blocked',
      'artifact.infra_delegation_files',
    ]) {
      expect(ARTIFACT_PROJECTABLE_EVENT_TYPES.has(fora)).toBe(false);
    }
  });

  it('todo versionado é também projetável', () => {
    for (const tipo of TIPOS_DE_ARTEFATO_VERSIONADOS) {
      expect(ARTIFACT_PROJECTABLE_EVENT_TYPES.has(tipo)).toBe(true);
    }
  });
});
