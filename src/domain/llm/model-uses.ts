import type { UsoDeModelo } from '@brabo/shared';

/**
 * Para QUE serve um modelo, na opinião de quem opera o workspace.
 *
 * É o eixo que nenhum catálogo publica. Provider declara capability — aceita
 * imagem, expõe raciocínio, aceita `tools` — e nada além disso; "melhor para
 * código" ou "bom para documentação" não existe em catálogo nenhum, e derivar
 * isso do nome do modelo seria palpite vestido de dado, que é exatamente o que
 * o ADR 0041 proíbe declarar como capability.
 *
 * Então é curadoria, e mora onde a curadoria mora: em `workspace_models`, por
 * workspace (ADR 0049). O time que gasta o dinheiro é quem descobre, na prática,
 * qual modelo rende no seu código — e essa opinião não vale para o vizinho.
 *
 * Vocabulário FECHADO de propósito. Texto livre daria `code`, `coding`, `Code`
 * e `código` na mesma tela em uma semana, e um filtro que não casa nada é pior
 * que filtro nenhum. Uso novo entra aqui e ganha migração, como qualquer outro
 * vocabulário do domínio.
 */
export const USOS_DE_MODELO = [
  'codigo',
  'documentacao',
  'analise',
  'imagem',
  'conversa',
] as const satisfies readonly UsoDeModelo[];

export type { UsoDeModelo };

/**
 * Exaustividade nos dois sentidos, como em `llm-provider-names.ts`: o
 * `satisfies` prova que nada SOBRA, esta linha prova que nada FALTA. Um uso
 * novo no tipo sem entrada aqui passaria pela validação do DTO e nunca
 * apareceria na tela.
 */
type UsoDeFora = Exclude<UsoDeModelo, (typeof USOS_DE_MODELO)[number]>;
const _todosOsUsosListados: UsoDeFora extends never ? true : never = true;
void _todosOsUsosListados;

export function isUsoDeModelo(valor: unknown): valor is UsoDeModelo {
  return (
    typeof valor === 'string' &&
    (USOS_DE_MODELO as readonly string[]).includes(valor)
  );
}
