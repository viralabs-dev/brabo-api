import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { projects } from '../db/schema';

/**
 * Liga `projects.sessao_de_teste` (RN-1076, ADR 0291, AT-898): a marca que faz
 * o Psicólogo gravar `psychologist.platform_signal` naquele projeto. Gesto de
 * OPERADOR do TP-01, logo depois de criar o projeto — sem tela e sem rota
 * pública, de propósito.
 *
 * Idempotente. Só liga: desligar é `UPDATE` à mão (nada no produto precisa).
 *
 * Uso: `pnpm projeto:marcar-teste <projectId>` (com `DATABASE_URL`).
 */
export async function marcarProjetoDeTeste(
  db: NodePgDatabase<typeof schema>,
  projectId: string,
): Promise<boolean> {
  const linhas = await db
    .update(projects)
    .set({ sessaoDeTeste: true })
    .where(eq(projects.id, projectId))
    .returning({ id: projects.id });
  return linhas.length > 0;
}

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!projectId) throw new Error('uso: projeto:marcar-teste <projectId>');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL é obrigatória');

  const pool = new Pool({ connectionString: url });
  try {
    const achou = await marcarProjetoDeTeste(
      drizzle(pool, { schema }),
      projectId,
    );
    if (!achou) {
      console.error(`[marcar-teste] projeto ${projectId} não existe`);
      process.exit(1);
    }
    console.log(
      `[marcar-teste] projeto ${projectId} marcado como sessão de teste`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('[marcar-teste] falhou:', error);
    process.exit(1);
  });
}
