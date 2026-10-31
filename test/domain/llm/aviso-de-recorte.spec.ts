import { describe, it, expect } from 'vitest';
import { avisoDeRecorte } from '../../../src/domain/llm/tool-router';

// RN-961 (revisa a RN-759): o aviso diz a verdade sobre o recorte do passo.
describe('avisoDeRecorte (RN-961)', () => {
  it('diz que as ferramentas fora do recorte podem ser pedidas neste passo, com a saída do catálogo completo', () => {
    const aviso = avisoDeRecorte(['listar_backlog', 'create_story'], 3);
    expect(aviso.role).toBe('system');
    expect(aviso.content).toContain(
      'seguem disponíveis e podem ser pedidas neste mesmo passo',
    );
    expect(aviso.content).toContain(
      'este passo é refeito com o catálogo completo',
    );
  });

  it('reprova o texto antigo, que mandava esperar pelo passo seguinte', () => {
    const texto = avisoDeRecorte(['listar_backlog'], 2).content;
    expect(texto).not.toContain('voltam nas próximas voltas');
    expect(texto).not.toContain('volta no seguinte');
  });
});
