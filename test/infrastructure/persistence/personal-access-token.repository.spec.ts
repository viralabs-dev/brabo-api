import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import {
  personalAccessTokens,
  projects,
  users,
  workspaces,
} from '../../../src/db/schema';
import { DrizzlePersonalAccessTokenRepository } from '../../../src/infrastructure/persistence/drizzle/personal-access-token.repository';

const { db, pool } = createTestDb();
const repo = new DrizzlePersonalAccessTokenRepository(db);

const DAQUI_A_UMA_HORA = () => new Date(Date.now() + 3_600_000);
const UMA_HORA_ATRAS = () => new Date(Date.now() - 3_600_000);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function seedUsuarioEProjeto(sufixo = 'a') {
  const [usuario] = await db
    .insert(users)
    .values({ email: `pat-${sufixo}@brabo.dev` })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: `acme-pat-${sufixo}`,
      slug: `acme-pat-${sufixo}`,
      createdBy: usuario.id,
    })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ws.id,
      name: `core-${sufixo}`,
      slug: `core-${sufixo}`,
      workspaceDirName: `core-pat-${sufixo}`,
      createdBy: usuario.id,
    })
    .returning();
  return { usuario, project };
}

describe('DrizzlePersonalAccessTokenRepository', () => {
  describe('emitir/validarEUsar', () => {
    it('caminho feliz: emite e valida', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-a',
        expiresAt: null,
      });

      const validado = await repo.validarEUsar('hash-a');

      expect(validado).toEqual({
        id: expect.any(String),
        userId: usuario.id,
        projectId: project.id,
      });
    });

    it('token desconhecido: null', async () => {
      expect(await repo.validarEUsar('hash-nunca-emitido')).toBeNull();
    });

    it('token revogado: null — mesma resposta de inexistente', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      const emitido = await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-revogado',
        expiresAt: null,
      });
      await repo.revogar(emitido.id, usuario.id, 'user_requested');

      expect(await repo.validarEUsar('hash-revogado')).toBeNull();
    });

    it('token expirado: null — mesma resposta de inexistente', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await db.insert(personalAccessTokens).values({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-velho',
        expiresAt: UMA_HORA_ATRAS(),
      });

      expect(await repo.validarEUsar('hash-velho')).toBeNull();
    });

    it('sem expiresAt (null): válido pra sempre — expiração é opcional', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-sem-expiracao',
        expiresAt: null,
      });

      expect(await repo.validarEUsar('hash-sem-expiracao')).not.toBeNull();
    });

    it('com expiresAt no futuro: válido', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-futuro',
        expiresAt: DAQUI_A_UMA_HORA(),
      });

      expect(await repo.validarEUsar('hash-futuro')).not.toBeNull();
    });

    it('toca last_used_at sempre que válido, sem throttle', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-usado',
        expiresAt: null,
      });

      await repo.validarEUsar('hash-usado');
      const [primeiro] = await repo.listarDoUsuarioNoProjeto(
        usuario.id,
        project.id,
      );
      expect(primeiro.lastUsedAt).not.toBeNull();

      // Um segundo uso IMEDIATO (bem dentro de qualquer janela de throttle
      // hipotética) continua válido — é a prova de que não há a condição de
      // "só toca se velho o bastante" no MESMO where da validação, que
      // rejeitaria um token válido reapresentado cedo demais.
      expect(await repo.validarEUsar('hash-usado')).not.toBeNull();
    });

    it('permite VÁRIOS tokens vivos por usuário+projeto ao mesmo tempo (um por máquina)', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-1',
        expiresAt: null,
      });
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'desktop',
        tokenHash: 'hash-2',
        expiresAt: null,
      });

      expect(await repo.validarEUsar('hash-1')).not.toBeNull();
      expect(await repo.validarEUsar('hash-2')).not.toBeNull();
    });
  });

  describe('listarDoUsuarioNoProjeto', () => {
    it('escopado ao usuário — não lista tokens de outro usuário no mesmo projeto', async () => {
      const { usuario: dono, project } = await seedUsuarioEProjeto('dono');
      const { usuario: outro } = await seedUsuarioEProjeto('outro');
      await repo.emitir({
        userId: dono.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-do-dono',
        expiresAt: null,
      });
      await repo.emitir({
        userId: outro.id,
        projectId: project.id,
        name: 'laptop-do-outro',
        tokenHash: 'hash-do-outro',
        expiresAt: null,
      });

      const lista = await repo.listarDoUsuarioNoProjeto(dono.id, project.id);

      expect(lista).toHaveLength(1);
      expect(lista[0].name).toBe('laptop');
    });

    it('nunca inclui o hash — PatResumo não tem o campo', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-segredo',
        expiresAt: null,
      });

      const [resumo] = await repo.listarDoUsuarioNoProjeto(
        usuario.id,
        project.id,
      );

      expect(resumo).not.toHaveProperty('tokenHash');
    });
  });

  describe('revogar', () => {
    it('caminho feliz: marca revokedAt e o motivo', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      const emitido = await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-a',
        expiresAt: null,
      });

      const revogado = await repo.revogar(
        emitido.id,
        usuario.id,
        'user_requested',
      );

      expect(revogado?.revokedAt).toBeInstanceOf(Date);
    });

    it('idempotente: revogar um já revogado devolve a linha, sem erro', async () => {
      const { usuario, project } = await seedUsuarioEProjeto();
      const emitido = await repo.emitir({
        userId: usuario.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-a',
        expiresAt: null,
      });
      await repo.revogar(emitido.id, usuario.id, 'user_requested');

      const segunda = await repo.revogar(
        emitido.id,
        usuario.id,
        'user_requested',
      );

      expect(segunda).not.toBeNull();
    });

    it('token de OUTRO usuário: null — mesma resposta de "não existe"', async () => {
      const { usuario: dono, project } = await seedUsuarioEProjeto('dono');
      const { usuario: outro } = await seedUsuarioEProjeto('outro');
      const emitido = await repo.emitir({
        userId: dono.id,
        projectId: project.id,
        name: 'laptop',
        tokenHash: 'hash-do-dono',
        expiresAt: null,
      });

      expect(
        await repo.revogar(emitido.id, outro.id, 'user_requested'),
      ).toBeNull();
    });

    it('id inexistente: null', async () => {
      const { usuario } = await seedUsuarioEProjeto();
      expect(
        await repo.revogar(
          '00000000-0000-0000-0000-000000000000',
          usuario.id,
          'user_requested',
        ),
      ).toBeNull();
    });
  });
});
