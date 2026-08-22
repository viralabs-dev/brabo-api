import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateProjectDto } from '../../../../src/interfaces/http/iam/dto/create-project.dto';
import { UpdateProjectDto } from '../../../../src/interfaces/http/iam/dto/update-project.dto';

/**
 * A borda HTTP do modo de execução (RN-169/RN-421, ADR 0072/0104).
 *
 * O que estes testes seguram é a herança: `UpdateProjectDto` é
 * `PartialType(CreateProjectDto)`, então TODO campo novo da criação entra na
 * rota de PATCH de graça — e ali não há guarda nenhuma, porque
 * `UpdateProjectUseCase` repassa o input direto ao repositório. Sem o
 * `OmitType`, um `PATCH { executionMode: 'mounted', workspacePath: '/etc' }`
 * gravaria a raiz de escopo sem passar pela validação da criação.
 */
function erros(Dto: new () => object, payload: object) {
  return validateSync(plainToInstance(Dto, payload) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateProjectDto — onde o código mora é escolha da criação', () => {
  const base = { name: 'Loja', slug: 'loja' };

  it('aceita os três modos', () => {
    for (const executionMode of ['container', 'mounted', 'runner'] as const) {
      expect(erros(CreateProjectDto, { ...base, executionMode })).toEqual([]);
    }
  });

  it('recusa modo que não existe', () => {
    const problemas = erros(CreateProjectDto, {
      ...base,
      executionMode: 'kubernetes',
    });
    expect(problemas.map((e) => e.property)).toContain('executionMode');
  });

  it('aceita o caminho como string — o veredito de verdade é do caso de uso', () => {
    // A borda só confere FORMA. Existe, é pasta e é gravável só têm resposta
    // tocando disco (RN-422), e isso mora no CreateProjectUseCase — para
    // `runner` nem isso: só o léxico (RN-423).
    expect(
      erros(CreateProjectDto, {
        ...base,
        executionMode: 'mounted',
        workspacePath: '/home/voce/projetos/loja',
      }),
    ).toEqual([]);
    expect(
      erros(CreateProjectDto, {
        ...base,
        executionMode: 'runner',
        workspacePath: '/home/voce/projetos/loja',
      }),
    ).toEqual([]);
  });
});

describe('UpdateProjectDto — o modo é CONGELADO depois da criação', () => {
  it('recusa executionMode no PATCH', () => {
    const problemas = erros(UpdateProjectDto, { executionMode: 'mounted' });
    expect(problemas.map((e) => e.property)).toContain('executionMode');
  });

  it('recusa workspacePath no PATCH', () => {
    const problemas = erros(UpdateProjectDto, { workspacePath: '/etc' });
    expect(problemas.map((e) => e.property)).toContain('workspacePath');
  });

  it('o que já era editável continua editável — a exclusão é cirúrgica', () => {
    expect(erros(UpdateProjectDto, { storyPromotion: 'auto' })).toEqual([]);
    expect(erros(UpdateProjectDto, { maxConsecutiveBlocked: 3 })).toEqual([]);
  });
});
