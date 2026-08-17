import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  lintarConteudo,
  lintarDiretorio,
  listarMigrations,
} from '../../scripts/lint-migracao';

/**
 * O linter de risco de migration do papel `dbre` (docs/fluxo.yml, ADR 0093).
 *
 * Só a lógica PURA (`lintarConteudo`) é o alvo principal — a leitura de
 * disco é exercitada à parte, com um diretório temporário, para não depender
 * do conteúdo real de `apps/api/src/db/migrations` (que muda a cada onda).
 */

describe('lintarConteudo', () => {
  it('SQL limpo não acha padrão de risco nenhum', () => {
    const sql = [
      'CREATE TABLE "widgets" (',
      '\t"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,',
      '\t"name" text NOT NULL,',
      '\t"created_at" timestamp with time zone DEFAULT now() NOT NULL',
      ');',
      '--> statement-breakpoint',
      'ALTER TABLE "widgets" ADD CONSTRAINT "widgets_name_unique" UNIQUE("name");',
    ].join('\n');

    expect(lintarConteudo('0099_limpo.sql', sql)).toEqual([]);
  });

  it('detecta DROP COLUMN', () => {
    const achados = lintarConteudo(
      '0099_arriscado.sql',
      'ALTER TABLE "projects" DROP COLUMN "permissions";',
    );

    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({
      arquivo: '0099_arriscado.sql',
      linha: 1,
      padrao: 'drop_column',
    });
  });

  it('detecta ALTER COLUMN ... SET DATA TYPE', () => {
    const achados = lintarConteudo(
      '0099_arriscado.sql',
      'ALTER TABLE "user_credentials" ALTER COLUMN "provider" SET DATA TYPE "public"."credential_provider" USING "provider"::text::"public"."credential_provider";',
    );

    expect(achados.map((a) => a.padrao)).toEqual(['alter_column_type']);
  });

  it('detecta ALTER COLUMN ... TYPE sem o `SET DATA`', () => {
    const achados = lintarConteudo(
      '0099_arriscado.sql',
      'ALTER TABLE "tasks" ALTER COLUMN "priority" TYPE integer;',
    );

    expect(achados.map((a) => a.padrao)).toEqual(['alter_column_type']);
  });

  it('detecta ADD COLUMN ... NOT NULL sem DEFAULT', () => {
    const achados = lintarConteudo(
      '0099_arriscado.sql',
      'ALTER TABLE "sessions" ADD COLUMN "trace_parent" text NOT NULL;',
    );

    expect(achados.map((a) => a.padrao)).toEqual([
      'add_column_not_null_sem_default',
    ]);
  });

  it('NÃO acusa ADD COLUMN ... NOT NULL quando há DEFAULT', () => {
    const achados = lintarConteudo(
      '0099_seguro.sql',
      'ALTER TABLE "tasks" ADD COLUMN "status" "task_status" DEFAULT \'todo\' NOT NULL;',
    );

    expect(achados).toEqual([]);
  });

  it('NÃO acusa ADD COLUMN nullable (sem NOT NULL)', () => {
    const achados = lintarConteudo(
      '0099_seguro.sql',
      'ALTER TABLE "tasks" ADD COLUMN "assigned_to" text;',
    );

    expect(achados).toEqual([]);
  });

  it('detecta DROP TABLE', () => {
    const achados = lintarConteudo(
      '0099_arriscado.sql',
      'DROP TABLE "legado";',
    );

    expect(achados.map((a) => a.padrao)).toEqual(['drop_table']);
  });

  it('detecta TRUNCATE', () => {
    const achados = lintarConteudo(
      '0099_arriscado.sql',
      'TRUNCATE "session_events";',
    );

    expect(achados.map((a) => a.padrao)).toEqual(['truncate']);
  });

  it('múltiplos padrões na MESMA migration — um achado por ocorrência, com a linha certa', () => {
    const sql = [
      'ALTER TABLE "a" DROP COLUMN "velha";--> statement-breakpoint',
      'ALTER TABLE "b" ADD COLUMN "nova" text NOT NULL;--> statement-breakpoint',
      'ALTER TABLE "c" ALTER COLUMN "d" SET DATA TYPE integer;',
    ].join('\n');

    const achados = lintarConteudo('0099_varios.sql', sql);

    expect(achados.map((a) => a.padrao)).toEqual([
      'drop_column',
      'add_column_not_null_sem_default',
      'alter_column_type',
    ]);
    expect(achados.map((a) => a.linha)).toEqual([1, 2, 3]);
    expect(achados.every((a) => a.arquivo === '0099_varios.sql')).toBe(true);
  });

  it('ignora o padrão de risco quando ele aparece só em COMENTÁRIO', () => {
    // Caso real: 0042_tough_captain_midlands.sql explica em comentário por
    // que a migration NÃO fez `ADD COLUMN ... NOT NULL` sem default — o
    // comentário cita o padrão exatamente para dizer que foi evitado.
    const sql = [
      "-- Adiciona nullable primeiro: um `ADD COLUMN ... NOT NULL` sem default falha",
      '-- contra uma tabela não-vazia.',
      'ALTER TABLE "projects" ADD COLUMN "workspace_dir_name" text;',
    ].join('\n');

    expect(lintarConteudo('0042_real.sql', sql)).toEqual([]);
  });

  it('trecho relatado é aparado quando a linha é muito longa', () => {
    const linhaGigante = `ALTER TABLE "x" DROP COLUMN "y"; -- ${'z'.repeat(200)}`;
    const achados = lintarConteudo('0099_gigante.sql', linhaGigante);

    expect(achados[0].trecho.length).toBeLessThan(linhaGigante.length);
    expect(achados[0].trecho.endsWith('…')).toBe(true);
  });
});

describe('lintarDiretorio', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('varre todo `.sql` do diretório, em ordem, e agrega os achados', () => {
    dir = mkdtempSync(join(tmpdir(), 'lint-migracao-'));
    writeFileSync(
      join(dir, '0002_segundo.sql'),
      'ALTER TABLE "a" DROP COLUMN "x";',
    );
    writeFileSync(
      join(dir, '0001_primeiro.sql'),
      'CREATE TABLE "limpo" ("id" uuid PRIMARY KEY);',
    );
    // Arquivo não-SQL no mesmo diretório (ex.: pasta `meta/`) não deve entrar.
    writeFileSync(join(dir, 'README.md'), '# nada de SQL aqui');

    expect(listarMigrations(dir)).toEqual([
      '0001_primeiro.sql',
      '0002_segundo.sql',
    ]);

    const achados = lintarDiretorio(dir);
    expect(achados).toHaveLength(1);
    expect(achados[0].arquivo).toBe('0002_segundo.sql');
  });

  it('diretório sem achado nenhum devolve lista vazia', () => {
    dir = mkdtempSync(join(tmpdir(), 'lint-migracao-'));
    writeFileSync(
      join(dir, '0001_limpo.sql'),
      'CREATE TABLE "limpo" ("id" uuid PRIMARY KEY);',
    );

    expect(lintarDiretorio(dir)).toEqual([]);
  });
});
