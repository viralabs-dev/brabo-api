import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ARQUIVOS_CURADOS,
  CORPUS_ROOT,
} from '../../scripts/seed-golden-set-rag';

describe('corpus congelado do golden-set de RAG (ADR 0132, AT-693)', () => {
  it('indexa os 22 caminhos lógicos de sempre', () => {
    expect(ARQUIVOS_CURADOS).toHaveLength(22);
    expect(ARQUIVOS_CURADOS[0]).toBe('docs/business-rules.md');
    expect(ARQUIVOS_CURADOS).toContain('docs/explanation/branching-policy.md');
  });

  it.each([...ARQUIVOS_CURADOS])('%s existe no corpus congelado', (caminho) => {
    expect(existsSync(join(CORPUS_ROOT, caminho))).toBe(true);
  });
});
