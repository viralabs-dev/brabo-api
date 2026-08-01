import type { LLMProviderName } from '@brabo/shared';

/**
 * A lista dos providers, em RUNTIME.
 *
 * O tipo `LLMProviderName` vive em `@brabo/shared` porque a web também o usa;
 * a lista mora aqui porque `packages/shared` é 100% tipo — um `export const`
 * lá derruba a imagem de produção da api com
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (o `main` do pacote é `.ts`
 * cru, e o runtime roda o compilado). Ver a nota no topo do bloco LLM em
 * `packages/shared/src/index.ts`.
 *
 * A ordem é a de precedência do seed: o local primeiro, porque é o único que
 * não gasta dinheiro.
 */
export const LLM_PROVIDER_NAMES = [
  'ollama',
  'anthropic',
  'openai',
] as const satisfies readonly LLMProviderName[];

/**
 * Exaustividade nos DOIS sentidos, em tempo de compilação.
 *
 * O `satisfies` acima só prova que nada sobra na lista. Esta linha prova que
 * nada FALTA: acrescentar um provider ao tipo sem acrescentá-lo aqui deixaria
 * o `syncModelCatalog` pulando-o em silêncio — exatamente a falha invisível
 * que a RN-043 existe para impedir.
 */
type NomeDeFora = Exclude<LLMProviderName, (typeof LLM_PROVIDER_NAMES)[number]>;
const _todosOsProvidersListados: NomeDeFora extends never ? true : never = true;
void _todosOsProvidersListados;
