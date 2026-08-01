import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * `packages/shared` não pode exportar NADA que sobreviva ao `tsc`.
 *
 * ## Por que isso é um teste, e não um comentário
 *
 * O invariante já existia — o `Dockerfile.prod` da api o declara em prosa
 * ("packages/shared, que é 100% tipos, por isso ele NÃO aparece no estágio
 * final") — mas nada o verificava. Um `export const` inocente no shared passou
 * por lint, typecheck, 926 testes e o build da imagem, e só apareceu no smoke
 * do compose de produção: o container da api morria no boot com
 *
 *     ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *     .../node_modules/@brabo/shared/src/index.ts
 *
 * porque o `main` do pacote aponta pro `.ts` cru e o Node se recusa a fazer
 * type stripping dentro de `node_modules`. Enquanto o shared só exporta tipo,
 * o `import` some na compilação e o `require` nunca acontece; um único valor
 * exportado transforma isso em falha de produção.
 *
 * Este teste é o passo mais barato do pipeline a reprovar essa mudança, em vez
 * do mais caro.
 *
 * ## O que fazer quando ele reprovar
 *
 * A lista em runtime mora no CONSUMIDOR — ver
 * `src/domain/llm/llm-provider-names.ts`, que guarda a da api amarrada ao tipo
 * do shared por checagem de exaustividade. Se um valor precisar mesmo ser
 * compartilhado entre api, web e engine, aí é decisão estrutural: dar um passo
 * de build ao `packages/shared` (com `main` apontando pro `dist`) e registrar
 * o ADR.
 */
describe('packages/shared é 100% tipo', () => {
  const caminho = join(__dirname, '../../../packages/shared/src/index.ts');
  const fonte = ts.createSourceFile(
    'index.ts',
    readFileSync(caminho, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );

  /** Declarações que o `tsc` APAGA — as únicas permitidas aqui. */
  const somenteTipo = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.ImportDeclaration,
    ts.SyntaxKind.ExportDeclaration,
    ts.SyntaxKind.EndOfFileToken,
  ]);

  it('não declara nada que sobreviva à compilação', () => {
    const sobreviventes = fonte.statements
      .filter((s) => !somenteTipo.has(s.kind))
      .map((s) => `${ts.SyntaxKind[s.kind]}: ${s.getText().split('\n')[0]}`);

    expect(sobreviventes).toEqual([]);
  });

  it('não exporta enum — mesmo `const enum` emite objeto sob isolatedModules', () => {
    const enums = fonte.statements.filter(ts.isEnumDeclaration);

    expect(enums.map((e) => e.name.text)).toEqual([]);
  });
});
