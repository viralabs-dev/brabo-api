import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARQUIVOS_CURADOS,
  CORPUS_ROOT,
} from '../../scripts/seed-golden-set-rag';

// Bytes do último verde do piso 17/17 (monorepo 6d56eb3872, AT-763): 1 555 499 bytes = 1 524 853 caracteres.
const BYTES = 1_555_499;
const SHA256 =
  '72ebf856747d2a2414b4c7709f23aa6af0f0c732d4b7383d022c5dbe2ede9aa1';

describe('corpus fixo do golden-set de RAG (ADR 0132, AT-693, AT-763)', () => {
  it('indexa os 22 caminhos lógicos de sempre', () => {
    expect(ARQUIVOS_CURADOS).toHaveLength(22);
    expect(ARQUIVOS_CURADOS[0]).toBe('docs/business-rules.md');
    expect(ARQUIVOS_CURADOS).toContain('docs/explanation/branching-policy.md');
  });

  it.each([...ARQUIVOS_CURADOS])('%s existe no corpus fixo', (caminho) => {
    expect(existsSync(join(CORPUS_ROOT, caminho))).toBe(true);
  });

  it('guarda de deriva: tamanho, contagem e hash do último verde', () => {
    const hash = createHash('sha256');
    let bytes = 0;
    for (const caminho of ARQUIVOS_CURADOS) {
      const buf = readFileSync(join(CORPUS_ROOT, caminho));
      bytes += buf.length;
      hash.update(caminho).update(buf);
    }
    expect({ arquivos: ARQUIVOS_CURADOS.length, bytes }).toEqual({
      arquivos: 22,
      bytes: BYTES,
    });
    expect(hash.digest('hex')).toBe(SHA256);
  });
});
