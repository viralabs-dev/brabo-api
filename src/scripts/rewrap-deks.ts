import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { EnvelopeEncryptionService } from '../infrastructure/security/envelope-encryption.service';
import { userCredentials, projectGitConnections } from '../db/schema';
import type { EncryptedSecret } from '../application/ports/encryption.port';

/**
 * Re-embrulha os DEKs na chave mestra ATUAL — o passo do meio da rotação
 * (Fase 5, item 3). Ver docs/runbooks/rotacao-chave-mestra.md.
 *
 * Roda com as DUAS variáveis definidas: `CREDENTIALS_MASTER_KEY` com a chave
 * nova e `CREDENTIALS_MASTER_KEY_PREVIOUS` com a antiga. Cada registro é aberto
 * com a chave que funcionar e regravado com a nova.
 *
 * Vive em `src/` e não em `apps/api/scripts/` de propósito: `scripts/` está no
 * .dockerignore (são demos de desenvolvimento) e este script precisa estar
 * DENTRO da imagem de produção — é lá que a rotação acontece. Compila junto com
 * o resto e roda como `node scripts/rewrap-deks.js`, no mesmo espírito do
 * `node db/migrate.js`.
 *
 * ## Garantias
 *
 * - **Idempotente**: registro já na chave atual é contado como `jaAtual` e
 *   pulado. Rodar duas vezes não reescreve nada e não custa nada.
 * - **Não toca no conteúdo cifrado**: só o envelope do DEK muda. O texto
 *   cifrado do segredo permanece byte a byte o mesmo, então uma falha no meio
 *   deixa o acervo consistente — parte na chave nova, parte na antiga, e as
 *   duas legíveis enquanto a variável PREVIOUS existir.
 * - **Um UPDATE por registro**, sem transação global: uma transação envolvendo
 *   milhares de linhas seguraria lock por minutos e daria a chance de perder
 *   tudo por um timeout no fim.
 */

interface Resultado {
  tabela: string;
  total: number;
  reembrulhados: number;
  jaAtual: number;
  falhas: number;
}

function envelope(linha: {
  wrappedDek: string;
  dekIv: string;
  dekAuthTag: string;
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
}): EncryptedSecret {
  return {
    wrappedDek: linha.wrappedDek,
    dekIv: linha.dekIv,
    dekAuthTag: linha.dekAuthTag,
    encryptedApiKey: linha.encryptedApiKey,
    apiKeyIv: linha.apiKeyIv,
    apiKeyAuthTag: linha.apiKeyAuthTag,
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL é obrigatória');

  if (!process.env.CREDENTIALS_MASTER_KEY) {
    throw new Error('CREDENTIALS_MASTER_KEY é obrigatória (a chave NOVA)');
  }
  if (!process.env.CREDENTIALS_MASTER_KEY_PREVIOUS) {
    // Sem a anterior o script não tem o que rotacionar: tudo abriria com a
    // atual e ele reportaria "nada a fazer", escondendo um erro de operação
    // (esqueceu de publicar a chave antiga) atrás de uma saída de sucesso.
    throw new Error(
      'CREDENTIALS_MASTER_KEY_PREVIOUS é obrigatória — sem ela não há rotação a fazer',
    );
  }

  const cofre = new EnvelopeEncryptionService();
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const resultados: Resultado[] = [];

  try {
    for (const tabela of [userCredentials, projectGitConnections] as const) {
      const nome =
        tabela === userCredentials
          ? 'user_credentials'
          : 'project_git_connections';
      const resultado: Resultado = {
        tabela: nome,
        total: 0,
        reembrulhados: 0,
        jaAtual: 0,
        falhas: 0,
      };

      const linhas = await db.select().from(tabela);
      resultado.total = linhas.length;

      for (const linha of linhas) {
        try {
          const novo = cofre.rewrap(envelope(linha));
          if (!novo) {
            resultado.jaAtual += 1;
            continue;
          }
          await db
            .update(tabela)
            .set({
              wrappedDek: novo.wrappedDek,
              dekIv: novo.dekIv,
              dekAuthTag: novo.dekAuthTag,
            })
            .where(eq(tabela.id, linha.id));
          resultado.reembrulhados += 1;
        } catch (error) {
          // Uma linha ilegível não pode abortar a rotação das outras: o acervo
          // ficaria pela metade sem que ninguém soubesse quanto faltou. O
          // registro é contado, identificado, e o script sai com código de erro
          // no fim.
          resultado.falhas += 1;
          console.error(
            `[rewrap] ${nome}#${linha.id}: ${(error as Error).message}`,
          );
        }
      }

      resultados.push(resultado);
    }
  } finally {
    await pool.end();
  }

  console.log('\n[rewrap] resultado\n');
  for (const r of resultados) {
    console.log(
      `  ${r.tabela.padEnd(24)} total=${r.total}  re-embrulhados=${r.reembrulhados}  ` +
        `já na chave atual=${r.jaAtual}  falhas=${r.falhas}`,
    );
  }

  const falhas = resultados.reduce((soma, r) => soma + r.falhas, 0);
  if (falhas > 0) {
    console.error(
      `\n[rewrap] ${falhas} registro(s) não abriram com nenhuma das duas chaves. ` +
        'NÃO remova CREDENTIALS_MASTER_KEY_PREVIOUS até resolver.',
    );
    process.exit(1);
  }

  const pendentes = resultados.reduce((soma, r) => soma + r.reembrulhados, 0);
  console.log(
    pendentes === 0
      ? '\n[rewrap] nada a fazer — o acervo já está na chave atual.'
      : '\n[rewrap] concluído. Agora remova CREDENTIALS_MASTER_KEY_PREVIOUS e reinicie a api.',
  );
}

main().catch((error: unknown) => {
  console.error('[rewrap] falhou:', error);
  process.exit(1);
});
