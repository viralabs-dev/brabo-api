import { describe, it, expect } from 'vitest';
import { nomeESlugDoWorkspacePessoal } from '../../../src/domain/auth/personal-workspace';

const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const USER_ID = '01jc4z0000usuario000000001';

describe('nomeESlugDoWorkspacePessoal (RN-410)', () => {
  it('com nome: usa o nome no rótulo e no slug', () => {
    const { name, slug } = nomeESlugDoWorkspacePessoal(
      'Maria da Silva',
      'maria@brabo.dev',
      USER_ID,
    );

    expect(name).toBe('Workspace de Maria da Silva');
    expect(slug).toMatch(SLUG_VALIDO);
    expect(slug).toBe(`maria-da-silva-${USER_ID.slice(0, 8)}`);
  });

  it('sem nome: cai para o local-part do e-mail', () => {
    const { name, slug } = nomeESlugDoWorkspacePessoal(
      null,
      'fulano.beltrano@brabo.dev',
      USER_ID,
    );

    expect(name).toBe('Workspace de fulano.beltrano');
    expect(slug).toMatch(SLUG_VALIDO);
    expect(slug).toBe(`fulano-beltrano-${USER_ID.slice(0, 8)}`);
  });

  it('nome só com espaço em branco degrada para o e-mail, como se fosse ausente', () => {
    const { name } = nomeESlugDoWorkspacePessoal(
      '   ',
      'oculto@brabo.dev',
      USER_ID,
    );

    expect(name).toBe('Workspace de oculto');
  });

  it('acento e maiúscula viram kebab-case ASCII', () => {
    const { slug } = nomeESlugDoWorkspacePessoal(
      'João Ção Ñuñez',
      'joao@brabo.dev',
      USER_ID,
    );

    expect(slug).toMatch(SLUG_VALIDO);
    expect(slug.startsWith('joao-cao-nunez-')).toBe(true);
  });

  it('nome sem NENHUM caractere alfanumérico cai no fallback "workspace"', () => {
    const { slug } = nomeESlugDoWorkspacePessoal('***', 'x@brabo.dev', USER_ID);

    expect(slug).toMatch(SLUG_VALIDO);
    expect(slug).toBe(`workspace-${USER_ID.slice(0, 8)}`);
  });

  it('nunca inventa nome ou e-mail: usa só o que a entrada já tem', () => {
    const { name } = nomeESlugDoWorkspacePessoal(
      undefined,
      'so-isso@brabo.dev',
      USER_ID,
    );

    expect(name).toBe('Workspace de so-isso');
  });

  it('o sufixo torna o slug único mesmo com nome/e-mail idênticos entre duas contas', () => {
    const a = nomeESlugDoWorkspacePessoal(
      'Ana',
      'ana@brabo.dev',
      'id-a-11111111',
    );
    const b = nomeESlugDoWorkspacePessoal(
      'Ana',
      'ana@outro.dev',
      'id-b-22222222',
    );

    expect(a.slug).not.toBe(b.slug);
    expect(a.slug).toMatch(SLUG_VALIDO);
    expect(b.slug).toMatch(SLUG_VALIDO);
  });
});
