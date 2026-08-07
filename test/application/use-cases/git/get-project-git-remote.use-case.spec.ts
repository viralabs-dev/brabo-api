import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectRepositories,
  projects,
  users,
  workspaces,
  workspaceMembers,
} from '../../../../src/db/schema';
import { DrizzleProvisionedRepositoryRepository } from '../../../../src/infrastructure/persistence/drizzle/provisioned-repository.repository';
import { DrizzleUserCredentialRepository } from '../../../../src/infrastructure/persistence/drizzle/user-credential.repository';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleWorkspaceRepository } from '../../../../src/infrastructure/persistence/drizzle/workspace.repository';
import { EnvelopeEncryptionService } from '../../../../src/infrastructure/security/envelope-encryption.service';
import { ResolveCredentialOwnerUseCase } from '../../../../src/application/use-cases/llm/resolve-credential-owner.use-case';
import { GetProjectGitRemoteUseCase } from '../../../../src/application/use-cases/git/get-project-git-remote.use-case';

const { db, pool } = createTestDb();
const encryption = new EnvelopeEncryptionService();
const credenciais = new DrizzleUserCredentialRepository(db);
const useCase = new GetProjectGitRemoteUseCase(
  new DrizzleProvisionedRepositoryRepository(db),
  credenciais,
  encryption,
  new ResolveCredentialOwnerUseCase(
    new DrizzleProjectRepository(db),
    new DrizzleWorkspaceRepository(db),
  ),
);

/** Grava pelo repositório: a tabela é envelope encryption, não uma coluna. */
const cadastrarToken = (userId: string, token: string) =>
  credenciais.upsert(userId, 'github', encryption.encrypt(token));

const TOKEN = 'ghp_token_do_owner_0123456789';

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

/**
 * `dono` é quem CRIOU o workspace — é ele que a RN-058 elege, e não quem abriu
 * a sessão. O `outro` existe para provar isso: ele também é membro `owner`, e
 * a credencial dele nunca deve ser escolhida.
 */
async function cenario(provider: 'local' | 'github') {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-dono', email: 'dono@brabo.dev' })
    .returning();
  const [outro] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-outro', email: 'outro@brabo.dev' })
    .returning();

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
    .returning();
  await db.insert(workspaceMembers).values([
    { workspaceId: workspace.id, userId: dono.id, role: 'owner' },
    { workspaceId: workspace.id, userId: outro.id, role: 'owner' },
  ]);

  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: outro.id,
    })
    .returning();

  await db.insert(projectRepositories).values({
    projectId: project.id,
    provider,
    externalId:
      provider === 'local' ? '/data/git-repos/core.git' : 'daneiel/core',
    url:
      provider === 'local'
        ? 'file:///data/git-repos/core.git'
        : 'https://github.com/daneiel/core.git',
    defaultBranch: 'main',
    visibility: 'private',
    origin: 'created',
    provisionedBy: dono.id,
  });

  return { dono, outro, project };
}

describe('GetProjectGitRemoteUseCase', () => {
  it('provider local: devolve o caminho do bare repo, sem credencial', async () => {
    const { project } = await cenario('local');

    const remote = await useCase.execute(project.id);

    expect(remote.kind).toBe('local');
    expect(remote.origin).toBe('/data/git-repos/core.git');
    expect(remote.defaultBranch).toBe('main');
    // Não há o que decifrar, e pedir credencial para `local` quebraria o
    // `pnpm dev` de quem nunca cadastrou token nenhum.
    expect(remote.token).toBeUndefined();
  });

  it('provider remoto: devolve a URL LIMPA e o token à parte', async () => {
    const { dono, project } = await cenario('github');
    await cadastrarToken(dono.id, TOKEN);

    const remote = await useCase.execute(project.id);

    expect(remote.kind).toBe('remote');
    expect(remote.token).toBe(TOKEN);
    expect(remote.username).toBe('x-access-token');

    // O ponto do ADR 0056: a origem NÃO carrega credencial. É este valor que
    // vai parar no `.git/config`, dentro da pasta onde a RN-075 dá leitura
    // auto-aprovada ao dev agent.
    expect(remote.origin).toBe('https://github.com/daneiel/core.git');
    expect(remote.origin).not.toContain(TOKEN);
    expect(remote.origin).not.toContain('@');
  });

  it('usa a credencial do OWNER do workspace, não a de quem criou o projeto', async () => {
    const { outro, project } = await cenario('github');
    // Só o OUTRO tem credencial. O owner (criador do workspace) não tem.
    await cadastrarToken(outro.id, 'ghp_token_do_outro');

    await expect(useCase.execute(project.id)).rejects.toThrow(NotFoundException);
  });

  it('projeto sem repositório provisionado: 404 claro', async () => {
    await expect(
      useCase.execute('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundException);
  });

  it('owner sem credencial do provider: a mensagem diz DE QUEM é a que falta', async () => {
    const { project } = await cenario('github');

    await expect(useCase.execute(project.id)).rejects.toThrow(
      /owner do workspace/i,
    );
  });
});
