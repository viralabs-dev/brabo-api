import { describe, expect, it } from 'vitest';
import {
  FATOS_NO_CONTEXTO,
  TETO_DO_TEXTO,
  TETO_POR_CAMPO,
  textoDoPerfilDoAutor,
} from '../../../src/domain/graph/perfil-do-autor';

function fato(i: number, tamanho = 20) {
  return {
    hypothesisId: `hyp-${i}`,
    agenteAlvo: 'po',
    hipotese: `h${i} `.padEnd(tamanho, 'x'),
    sugestao: `s${i}`,
    aceitoEm: '2026-10-01T10:00:00.000Z',
  };
}

describe('textoDoPerfilDoAutor (RN-680)', () => {
  it('caminho feliz: lista os fatos com o agente-alvo, sem nota de recorte quando cabem todos', () => {
    const texto = textoDoPerfilDoAutor([fato(1)], 1);
    expect(texto).toContain('ELA aceitou neste projeto');
    expect(texto).toContain('- [po] h1');
    expect(texto).toContain('ajuste: s1');
    expect(texto).not.toContain('mais recentes de');
  });

  it('sem fato nenhum: null — o turno vai sem a mensagem', () => {
    expect(textoDoPerfilDoAutor([], 0)).toBeNull();
  });

  it('o recorte é DITO, e o teto vale mesmo se a leitura devolver mais', () => {
    const fatos = Array.from({ length: 8 }, (_, i) => fato(i));
    const texto = textoDoPerfilDoAutor(fatos, 12) as string;
    expect(texto.match(/^- \[/gm)).toHaveLength(FATOS_NO_CONTEXTO);
    expect(texto).toContain(`os ${FATOS_NO_CONTEXTO} mais recentes de 12`);
  });

  it('campo longo é cortado, e o texto inteiro cabe no teto do engine', () => {
    const fatos = Array.from({ length: 5 }, (_, i) => ({
      ...fato(i, 5000),
      agenteAlvo: 'a'.repeat(5000),
      sugestao: 'b'.repeat(5000),
    }));
    const texto = textoDoPerfilDoAutor(fatos, 5) as string;
    expect(texto).not.toContain('x'.repeat(TETO_POR_CAMPO + 1));
    expect(texto.length).toBeLessThanOrEqual(TETO_DO_TEXTO);
  });
});
