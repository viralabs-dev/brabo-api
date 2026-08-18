import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, workspaceMembers, workspaces } from '../../../../src/db/schema';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

/**
 * Workspace pessoal automático no registro (RN-410).
 *
 * Antes desta correção, `RegisterUseCase` criava usuário e credencial mas
 * NUNCA um workspace — toda conta nova caía numa parede silenciosa: o botão
 * "Novo projeto" do dashboard não fazia nada, porque `useCurrentWorkspace()`
 * não achava workspace nenhum. Só não aparecia antes porque o `seed.ts`
 * sempre criava um workspace junto dos dados de demonstração.
 */

let h: Harness;

beforeAll(async () => {
  h = await montarHarness();
}, 60_000);

beforeEach(async () => {
  await h.limpar();
  h.mail.limpar();
  h.hasher.limpar();
});

afterAll(async () => {
  await h.pool.end();
});

describe('RegisterUseCase: workspace pessoal automático (RN-410)', () => {
  it('conta nova ganha um workspace, com o usuário como owner', async () => {
    await contaPronta(h);

    const [usuario] = await h.db
      .select()
      .from(users)
      .where(eq(users.email, EMAIL));
    expect(usuario).toBeTruthy();

    const [workspace] = await h.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.createdBy, usuario.id));
    expect(workspace).toBeTruthy();
    expect(workspace.name).toContain('fulano');
    expect(workspace.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(workspace.slug).toContain(usuario.id.slice(0, 8));

    const [membro] = await h.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    expect(membro.userId).toBe(usuario.id);
    expect(membro.role).toBe('owner');
  });

  it('o e-mail duplicado NÃO cria um segundo workspace', async () => {
    await contaPronta(h);
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });

    const todos = await h.db.select().from(workspaces);
    expect(todos).toHaveLength(1);
  });

  it('nome informado no registro vira o nome do workspace, não o e-mail', async () => {
    await h.register.execute({
      email: 'com-nome@brabo.dev',
      senha: SENHA_BOA,
      nome: 'Maria da Silva',
    });

    const [usuario] = await h.db
      .select()
      .from(users)
      .where(eq(users.email, 'com-nome@brabo.dev'));
    const [workspace] = await h.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.createdBy, usuario.id));

    expect(workspace.name).toBe('Workspace de Maria da Silva');
    expect(workspace.slug).toMatch(/^maria-da-silva-[a-z0-9]{8}$/);
  });
});
