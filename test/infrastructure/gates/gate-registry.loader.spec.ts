import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  carregarRegistro,
  limparCache,
  RegistroDeGatesInvalido,
} from '../../../src/infrastructure/gates/gate-registry.loader';
import {
  localizadoresDoRegistro,
  type GateRegistry,
} from '../../../src/domain/gates/gate-registry';

/**
 * O loader, contra a árvore que a IMAGEM DE PRODUÇÃO realmente tem.
 *
 * O defeito que este arquivo existe para impedir foi medido na v6.1.0
 * instalada: `GET /gates` respondia 500 repetidas vezes com
 * `RegistroDeGatesInvalido` listando os onze alvos de `docs/gates.yml`, todos
 * "não existe" — em TODA instalação, não numa borda.
 *
 * A causa não era o registro: era a pergunta. `docker/api/Dockerfile.prod`
 * copia para `/app` o `dist` achatado, `node_modules`, `db/migrations` e
 * `docs/gates.yml`. NÃO copia `apps/api/test/`, `scripts/ci/` nem `.github/` —
 * e eram esses os alvos que o loader cobrava. A régua "o arquivo de prova
 * existe" é afirmação sobre o REPOSITÓRIO, e mudou de lugar
 * (`validarLocalizadores`, cobrada por `gate-registry.spec.ts` e pela fase 2
 * do `validacao-gates.ts`).
 *
 * A fixture abaixo REPRODUZ essa árvore: uma raiz com `docs/gates.yml` e mais
 * nada. Nenhum mock — se alguém devolver a checagem ao loader, este arquivo
 * fica vermelho com a mesma mensagem que a instalação deu.
 */

const RAIZ_DO_REPO = join(__dirname, '../../../../..');
const YAML_REAL = readFileSync(join(RAIZ_DO_REPO, 'docs/gates.yml'), 'utf-8');

let raizFalsa: string;

/** `/app/docs/gates.yml` e nada mais — a árvore da imagem, em disco. */
function montarArvoreDaImagem(conteudo = YAML_REAL): string {
  const raiz = mkdtempSync(join(tmpdir(), 'brabo-gates-'));
  mkdirSync(join(raiz, 'docs'), { recursive: true });
  writeFileSync(join(raiz, 'docs/gates.yml'), conteudo);
  // O `dist` achatado que o Dockerfile.prod copia: é de dentro dele que o
  // loader sobe procurando o registro.
  mkdirSync(join(raiz, 'infrastructure/gates'), { recursive: true });
  return raiz;
}

beforeEach(() => {
  limparCache();
  raizFalsa = montarArvoreDaImagem();
});

afterEach(() => {
  limparCache();
  rmSync(raizFalsa, { recursive: true, force: true });
});

describe('carregarRegistro na árvore da imagem de produção', () => {
  it('a fixture é mesmo a imagem: nenhum alvo de prova existe nela', () => {
    const registro = parse(YAML_REAL) as GateRegistry;
    const alvos = localizadoresDoRegistro(registro);

    expect(alvos.length).toBeGreaterThan(0);
    for (const l of alvos) {
      expect(existsSync(join(raizFalsa, l.alvo))).toBe(false);
    }
  });

  it('carrega o registro real sem exigir os alvos que a imagem não leva', () => {
    const registro = carregarRegistro(join(raizFalsa, 'infrastructure/gates'));

    expect(registro.version).toBe(1);
    expect(registro.gates.length).toBeGreaterThan(0);
    expect(registro.gates.map((g) => g.id)).toContain('merge-protegida');
  });

  /**
   * O contrapeso: tirar a régua de repositório não pode ter transformado o
   * loader num `try/catch` que devolve registro vazio. Registro INVÁLIDO por
   * conteúdo continua lançando, na imagem como no checkout — servir um
   * registro errado é pior que falhar, porque quem consome passa a medir o
   * gate errado sem saber.
   */
  it('registro inválido por CONTEÚDO continua lançando, não vira vazio', () => {
    const invalido = YAML_REAL.replace(
      'aprovacao_humana: true # imutável — pipeline da Fase 1',
      'aprovacao_humana: false',
    );
    expect(invalido).not.toBe(YAML_REAL);

    rmSync(raizFalsa, { recursive: true, force: true });
    raizFalsa = montarArvoreDaImagem(invalido);

    expect(() =>
      carregarRegistro(join(raizFalsa, 'infrastructure/gates')),
    ).toThrow(RegistroDeGatesInvalido);
  });

  it('registro ausente continua sendo erro nomeado, nunca silêncio', () => {
    const semRegistro = mkdtempSync(join(tmpdir(), 'brabo-sem-gates-'));
    try {
      expect(() => carregarRegistro(semRegistro)).toThrow(
        /docs\/gates\.yml não encontrado/,
      );
    } finally {
      rmSync(semRegistro, { recursive: true, force: true });
    }
  });
});
