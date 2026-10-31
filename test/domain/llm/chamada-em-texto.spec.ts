import { describe, it, expect } from 'vitest';
import {
  caudaQuePodeSerMarcador,
  marcacaoDeChamadaEmTexto,
} from '../../../src/domain/llm/chamada-em-texto';

const FERRAMENTAS = ['emit_artifact', 'read_file'];
// Recorte do payload real da sessão 2b5161d0, seq 4 (AT-633).
export const PAYLOAD_REAL = `Registrei as regras de negócio.


<invoke name="emit_artifact">
<parameter name="type">decision_record</parameter>
<parameter name="title">Restrições técnicas declaradas pelo usuário</parameter>
</invoke>`;

describe('marcacaoDeChamadaEmTexto (AT-633, RN-949)', () => {
  it.each([
    ['payload real', PAYLOAD_REAL],
    ['function_calls', 'ok <function_calls>\n<invoke name="x">'],
    ['antml', '<function_calls><invoke name="read_file">'],
    ['invoke', '<invoke name="read_file"></invoke>'],
    ['tool_call', '<tool_call>{"name":"read_file","arguments":{}}</tool_call>'],
  ])('detecta: %s', (_n, t) => {
    expect(marcacaoDeChamadaEmTexto(t, FERRAMENTAS)).not.toBeNull();
  });

  it.each([
    ['bloco cercado', '```xml\n<invoke name="read_file">\n```'],
    ['inline', 'use `<invoke name="read_file">` assim'],
    ['prosa', 'o parameter name= é só texto'],
    ['nome que não é ferramenta', '<invoke name="outra">'],
    ['tool_call de outro nome', '<tool_call>{"name":"outra"}</tool_call>'],
    ['JSON solto (ADR 0020)', '{"name":"read_file","arguments":{}}'],
  ])('não detecta: %s', (_n, t) => {
    expect(marcacaoDeChamadaEmTexto(t, FERRAMENTAS)).toBeNull();
  });

  it('sem ferramentas na chamada não detecta', () => {
    expect(marcacaoDeChamadaEmTexto(PAYLOAD_REAL, [])).toBeNull();
  });

  it('retém só o fim que pode ser início de marcador', () => {
    expect(caudaQuePodeSerMarcador('oi <inv')).toBe(4);
    expect(caudaQuePodeSerMarcador('oi <b>x')).toBe(0);
    expect(caudaQuePodeSerMarcador('oi')).toBe(0);
  });
});
