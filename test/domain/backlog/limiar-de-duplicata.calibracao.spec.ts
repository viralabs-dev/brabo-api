import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ehDuplicataSemantica,
  LIMIAR_DE_DUPLICATA_SEMANTICA,
  similaridadeCosseno,
} from '../../../src/domain/backlog/duplicata-semantica';
import { RAG_EMBEDDING_MODEL } from '../../../src/domain/rag/rag-search-limits';

/**
 * A prova do NÚMERO do limiar (RN-681, ADR 0198): sobre vetores GRAVADOS do
 * modelo de embedding real, todo par `duplicata` de `pares.json` tem de
 * AVISAR e todo par `distinta` tem de PASSAR — o par do achado R incluso.
 *
 * Roda sozinha quando `vetores.json` existe. Ele NÃO existe ainda: o
 * ambiente em que a RN-681 nasceu não alcançava o registry do Ollama nem o
 * Hugging Face (medido, ADR 0198), e vetor inventado à mão provaria só a mão.
 * Até alguém gravar (`scripts/gravar-vetores-de-duplicata.ts`), o describe é
 * PULADO com aviso — nunca passa calado, e o limiar segue declarado como
 * ponto de partida não calibrado. Mesma régua do smoke de embedding do Ollama.
 */
const PASTA = join(__dirname, '..', '..', 'fixtures', 'duplicata-semantica');
const ARQUIVO_DE_VETORES = join(PASTA, 'vetores.json');
const gravado = existsSync(ARQUIVO_DE_VETORES);

if (!gravado) {
  console.warn(
    '[calibração] test/fixtures/duplicata-semantica/vetores.json não existe — ' +
      `o limiar ${LIMIAR_DE_DUPLICATA_SEMANTICA} da RN-681 NÃO está provado ` +
      'contra vetores reais. Grave com scripts/gravar-vetores-de-duplicata.ts ' +
      '(Ollama com o modelo do RAG puxado). Ver ADR 0198.',
  );
}

interface Par {
  origem: string;
  a: string;
  b: string;
}

const pares = JSON.parse(readFileSync(join(PASTA, 'pares.json'), 'utf8')) as {
  duplicata: Par[];
  distinta: Par[];
};

describe('os pares de calibração (sempre)', () => {
  it('o par do achado R está entre os que TÊM de avisar', () => {
    expect(pares.duplicata).toContainEqual(
      expect.objectContaining({
        a: 'Endpoint público de saudação determinística',
        b: 'Endpoint GET /hello público que devolve saudação imediata',
      }),
    );
  });

  it('há pares dos DOIS lados — um limiar provado só de um lado não separa nada', () => {
    expect(pares.duplicata.length).toBeGreaterThan(0);
    expect(pares.distinta.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!gravado)(
  `o limiar ${LIMIAR_DE_DUPLICATA_SEMANTICA} contra vetores gravados`,
  () => {
    const arquivo = gravado
      ? (JSON.parse(readFileSync(ARQUIVO_DE_VETORES, 'utf8')) as {
          modelo: string;
          vetores: Record<string, number[]>;
        })
      : { modelo: '', vetores: {} };

    const cos = (p: Par) => {
      const a = arquivo.vetores[p.a];
      const b = arquivo.vetores[p.b];
      expect(a, `sem vetor gravado para "${p.a}"`).toBeDefined();
      expect(b, `sem vetor gravado para "${p.b}"`).toBeDefined();
      return similaridadeCosseno(a, b);
    };

    it('foi gravado com o modelo que a checagem usa', () => {
      expect(arquivo.modelo.startsWith(RAG_EMBEDDING_MODEL)).toBe(true);
    });

    it.each(pares.duplicata)('AVISA: $a × $b ($origem)', (p) => {
      expect(ehDuplicataSemantica(cos(p))).toBe(true);
    });

    it.each(pares.distinta)('PASSA: $a × $b ($origem)', (p) => {
      expect(ehDuplicataSemantica(cos(p))).toBe(false);
    });
  },
);
