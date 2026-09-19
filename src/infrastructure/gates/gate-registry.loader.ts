import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import {
  validarRegistro,
  type GateRegistry,
} from '../../domain/gates/gate-registry';

/**
 * Lê `docs/gates.yml`. O domínio valida; aqui só acontece o IO.
 *
 * ## O caminho é descoberto, não configurado
 *
 * O mesmo arquivo é lido de três lugares com raízes diferentes: o teste e o
 * script rodam de `apps/api` sob ts-node, o build roda de `dist/`, e a imagem
 * de produção tem outra árvore ainda. Uma variável de ambiente resolveria, e
 * seria mais uma coisa para configurar errado; subir de `__dirname` até achar
 * `docs/gates.yml` cobre os três com uma regra só.
 *
 * ## O que ele valida, e o que NÃO valida
 *
 * Só `validarRegistro` — o que é verdade sobre o CONTEÚDO do registro, e vale
 * onde quer que ele seja lido. A outra régua, `validarLocalizadores` (o
 * arquivo de prova que `evidencia` cita existe no disco), é afirmação sobre o
 * REPOSITÓRIO e roda no CI: no teste do arquivo real e na fase 2 do
 * `validacao-gates.ts`.
 *
 * A separação nasceu de um defeito MEDIDO na v6.1.0 instalada: `GET /gates`
 * respondia 500 com `RegistroDeGatesInvalido` listando os onze alvos de
 * `docs/gates.yml`, todos "não existe". Não era o registro estando errado —
 * era a pergunta errada. A imagem de produção leva `/app/docs/gates.yml`, o
 * `dist` achatado, `db/migrations` e `node_modules`; `apps/api/test/`,
 * `scripts/ci/` e `.github/` nunca entram nela, então a régua de repositório
 * reprovava TODOS os gates em TODA instalação, e a tela de gates quebrava.
 *
 * Nada foi afrouxado: a régua continua existindo, com os mesmos alvos, e
 * continua reprovando alvo que sumiu — só que onde a pergunta faz sentido.
 */
export const CAMINHO_RELATIVO = 'docs/gates.yml';

/** Sobe do diretório dado até achar o registro. `null` se não achar. */
export function acharRegistro(
  partindoDe: string,
  existe: (caminho: string) => boolean = existsSync,
): string | null {
  let atual = resolve(partindoDe);

  // Para na raiz do filesystem: `dirname('/')` é `'/'`.
  for (;;) {
    const candidato = join(atual, CAMINHO_RELATIVO);
    if (existe(candidato)) return candidato;

    const pai = dirname(atual);
    if (pai === atual) return null;
    atual = pai;
  }
}

export class RegistroDeGatesInvalido extends Error {
  constructor(readonly problemas: string[]) {
    super(`docs/gates.yml inválido:\n  - ${problemas.join('\n  - ')}`);
    this.name = 'RegistroDeGatesInvalido';
  }
}

let cache: GateRegistry | null = null;

/**
 * O registro validado, memoizado.
 *
 * Carga PREGUIÇOSA de propósito: um arquivo ilegível não pode derrubar o boot
 * da api inteira por causa de uma leitura. Quem chamar recebe o erro; quem não
 * chamar nem fica sabendo.
 */
export function carregarRegistro(partindoDe = __dirname): GateRegistry {
  if (cache) return cache;

  const caminho = acharRegistro(partindoDe);
  if (!caminho) {
    throw new RegistroDeGatesInvalido([
      `${CAMINHO_RELATIVO} não encontrado a partir de ${partindoDe}`,
    ]);
  }

  const registro = parse(readFileSync(caminho, 'utf-8')) as GateRegistry;
  const problemas = validarRegistro(registro);

  // Servir registro inválido é pior que falhar: quem consome passaria a medir
  // o gate errado sem saber.
  if (problemas.length > 0) {
    throw new RegistroDeGatesInvalido(
      problemas.map((p) => `${p.gate ?? '(registro)'}: ${p.detalhe}`),
    );
  }

  cache = registro;
  return registro;
}

/** Só para teste: a memoização é por processo. */
export function limparCache(): void {
  cache = null;
}
