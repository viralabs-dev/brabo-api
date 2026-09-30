import { commandFromPayload } from './pattern-for-action';
import { parseCommand } from './command-matcher';
import { motivoDeRecusaSempreAprovar } from './external-effect';
import type { ActionType } from './decide';

/**
 * Os tipos de ação para os quais "sempre permitir" NUNCA grava padrão
 * (AT-320, RN-642). É a lista ÚNICA: a api recusa o clique por ela e a web
 * (`apps/web/src/lib/sempre-permitir.ts`) esconde o botão pela cópia que o
 * teste de lá confere contra ESTE arquivo — nunca uma régua escrita duas vezes.
 *
 * Dois grupos, a mesma consequência:
 * - efeito externo git TIPADO (`git_push`, `pr_open`, `git_merge`): a metade
 *   tipada do teto da RN-418, que até aqui só recusava o COMANDO de terminal
 *   (`git push` digitado). Sem isto um clique gravava `GitPush()` em
 *   `permissions.json/allow` para o projeto inteiro. `git_merge` entra
 *   inteiro, não só para branch protegida: o destino é do payload de CADA
 *   proposta, e o padrão gravado (`GitMerge()`) valeria para todas.
 * - os tetos absolutos de `decide.ts` que não são comando: `container_remove`
 *   (RN-495), `instruction_patch` e `parallelize`/`raise_max_parallel`
 *   (RN-154). Ali o padrão gravado seria INERTE (o teto roda depois do
 *   arquivo) — gravá-lo só faria a tela prometer o que não acontece.
 *
 * NÃO muda `decide()` nem a semeadura: `DEV_AUTO_GIT_ACTIONS` continua dando
 * `auto_approve` a `git_commit`/`git_push`/`pr_open` por `dev-<modulo>` na
 * ativação (ADR 0053). O que se fecha é o CLIQUE humano criar autonomia nova
 * para esses tipos, não a autonomia que a ativação já concede.
 */
export const TIPOS_SEM_SEMPRE_PERMITIR: readonly ActionType[] = [
  'git_push',
  'pr_open',
  'git_merge',
  'container_remove',
  'instruction_patch',
  'parallelize',
  'raise_max_parallel',
];

/** O `reason` do 400 de "sempre permitir" recusado por teto. */
export const TETO_DO_SEMPRE_PERMITIR = 'teto_do_sempre_permitir';

const MOTIVO_POR_TIPO: Record<string, string> = {
  git_push: 'push leva código para fora da máquina (teto da RN-418)',
  pr_open: 'abrir PR publica no provider (teto da RN-418)',
  git_merge:
    'merge é decisão a cada vez — em branch protegida, nunca automatizável',
  container_remove:
    'remover o container descarta o que existe e exige reprovisionar do zero',
  instruction_patch:
    'mudar a instrução de um agente pede revisar o diff a cada vez',
  parallelize: 'gastar com mais agentes é decisão sua a cada vez',
  raise_max_parallel: 'subir o teto de paralelismo é decisão sua a cada vez',
};

/**
 * `null` quando "sempre permitir" pode gravar o padrão desta ação; senão o
 * motivo, em texto para a pessoa. Terminal é julgado pelo COMANDO
 * (`motivoDeRecusaSempreAprovar`, RN-418); o resto pelo TIPO.
 */
export function motivoDeRecusaDoSempreAprovar(
  actionType: string,
  payload: unknown,
): string | null {
  if (actionType === 'terminal') {
    const command = commandFromPayload(payload);
    return command ? motivoDeRecusaSempreAprovar(parseCommand(command)) : null;
  }
  if (!(TIPOS_SEM_SEMPRE_PERMITIR as readonly string[]).includes(actionType)) {
    return null;
  }
  return (
    `"sempre permitir" não grava padrão para "${actionType}": ` +
    `${MOTIVO_POR_TIPO[actionType]}. Aprove só esta instância pelo fluxo ` +
    `normal de aprovação.`
  );
}
