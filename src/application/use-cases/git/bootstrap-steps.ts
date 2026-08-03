import type { GitProviderContract } from '@brabo/shared';
import { GitBranchAlreadyExistsError } from '../../../domain/git/git-errors';
import type { BootstrapStepName } from '../../../domain/git/repo-bootstrap.entity';
import {
  BRANCHING_POLICY_PATH,
  PR_TEMPLATE_PATH,
  branchingPolicyContent,
  prTemplateContent,
} from './bootstrap-templates';

export interface BootstrapStepCtx {
  provider: GitProviderContract;
  externalId: string;
  defaultBranch: string;
  accessToken?: string;
}

export type BootstrapActionType =
  'git_branch_create' | 'git_branch_protect' | 'git_commit';

// Uma mutação individual ainda pendente dentro de um passo — "cada
// mutação nasce como proposed_action" (CLAUDE.md) exige granularidade
// por mutação, não por passo: `protect_branches` é UM passo que pode ter
// até 4 mutações pendentes (uma por branch ainda não protegida).
export interface BootstrapMutation {
  actionType: BootstrapActionType;
  payload: Record<string, unknown>;
  run(ctx: BootstrapStepCtx): Promise<Record<string, unknown>>;
}

export interface BootstrapStep {
  readonly step: BootstrapStepName;
  /**
   * Lista as mutações ainda pendentes pra esse passo — lista vazia
   * significa "já satisfeito" (skip, `bootstrap.step_skipped`).
   * `'capability_unsupported'` significa que o provider não suporta a
   * operação (degrada com aviso, `bootstrap.step_degraded`, nunca
   * falha). Chamado em TODA execução, mesmo pra passos já concluídos —
   * é isso que garante idempotência e retomada correta (ver
   * docs/adr/0005).
   */
  check(
    ctx: BootstrapStepCtx,
  ): Promise<BootstrapMutation[] | 'capability_unsupported'>;
}

// dev←main, qa←dev — cascata de promoção do pipeline dev→qa→main.
//
// Havia um terceiro degrau, `rc`, criado a partir de `qa`. O ADR 0030 o
// removeu da política do Brabo ("sem ambiente e sem gente para exercê-lo,
// seria degrau cerimonial") e o `pr-police` do CI opera com três desde então —
// mas o bootstrap continuou criando e protegendo `rc` no repositório do
// usuário, e o `branching-policy.md` que ele commita continuou ensinando a
// escada de quatro. Era o achado #3 do primeiro dogfooding.
function createBranchStep(
  step: BootstrapStepName,
  branchName: string,
  fromRef: string,
): BootstrapStep {
  return {
    step,
    async check(ctx): Promise<BootstrapMutation[]> {
      const branches = await ctx.provider.listBranches({
        externalId: ctx.externalId,
        accessToken: ctx.accessToken,
      });
      if (branches.some((b) => b.name === branchName)) return [];

      return [
        {
          actionType: 'git_branch_create',
          payload: { branchName, fromRef },
          async run(runCtx) {
            try {
              const branch = await runCtx.provider.createBranch({
                externalId: runCtx.externalId,
                branchName,
                fromRef,
                accessToken: runCtx.accessToken,
              });
              return { branchName: branch.name, commitSha: branch.commitSha };
            } catch (error) {
              // Corrida entre check() e run() — a branch já existe
              // agora, tratado como satisfeito, não como falha.
              if (error instanceof GitBranchAlreadyExistsError) {
                return { branchName, note: 'já existia (corrida)' };
              }
              throw error;
            }
          },
        },
      ];
    },
  };
}

// Um só passo, com até 3 mutações internas (uma por branch ainda não
// protegida) — da ponta de produção para a de integração: main, qa, dev.
const PROTECTED_BRANCH_NAMES = ['main', 'qa', 'dev'] as const;

/**
 * As branches que o template CONHECE — as mesmas que ele protege, já que
 * `main` é criada pelo provider e as outras duas pelos passos acima.
 * Exportado para o dry-run da adoção (Fase 12a) poder chamar de "extra"
 * o que não está aqui: uma branch fora desta lista é política própria do
 * projeto adotado, informativa e nunca tocada pelo bootstrap.
 *
 * `rc` saiu daqui junto com o degrau (ADR 0030), e a consequência na adoção é
 * correta e deliberada: um repositório que já tem `rc` — inclusive um
 * bootstrapado por uma versão anterior do Brabo — passa a vê-la classificada
 * como `extra_branch`. É o que ela é hoje: política do projeto, descrita no
 * plano e nunca tocada.
 *
 * A lista de merge protegido (`domain/actions/protected-branches.ts`) NÃO
 * perdeu `rc`, de propósito: aquela lista decide o que a trava de merge
 * recusa, e afrouxá-la para uma branch que ainda existe em repositórios
 * antigos trocaria um degrau cerimonial por um merge automático em produção.
 */
export const TEMPLATE_BRANCH_NAMES: readonly string[] = PROTECTED_BRANCH_NAMES;

const protectBranchesStep: BootstrapStep = {
  step: 'protect_branches',
  async check(ctx): Promise<BootstrapMutation[] | 'capability_unsupported'> {
    if (!ctx.provider.capabilities.protectBranch) {
      return 'capability_unsupported';
    }

    const branches = await ctx.provider.listBranches({
      externalId: ctx.externalId,
      accessToken: ctx.accessToken,
    });
    const branchByName = new Map(branches.map((b) => [b.name, b]));

    const pending: BootstrapMutation[] = [];
    for (const branchName of PROTECTED_BRANCH_NAMES) {
      const branch = branchByName.get(branchName);
      if (!branch || branch.protected) continue;

      pending.push({
        actionType: 'git_branch_protect',
        payload: { branchName },
        async run(runCtx) {
          await runCtx.provider.protectBranch({
            externalId: runCtx.externalId,
            branchName,
            accessToken: runCtx.accessToken,
          });
          return { branchName };
        },
      });
    }
    return pending;
  },
};

function commitFileStep(
  step: BootstrapStepName,
  path: string,
  content: () => string,
  commitMessage: string,
): BootstrapStep {
  return {
    step,
    async check(ctx): Promise<BootstrapMutation[]> {
      const canonical = content();
      const current = await ctx.provider.getFileContent({
        externalId: ctx.externalId,
        branch: ctx.defaultBranch,
        path,
        accessToken: ctx.accessToken,
      });
      if (current === canonical) return [];

      return [
        {
          actionType: 'git_commit',
          payload: { path, branch: ctx.defaultBranch },
          async run(runCtx) {
            const result = await runCtx.provider.commitFiles({
              externalId: runCtx.externalId,
              branch: runCtx.defaultBranch,
              message: commitMessage,
              files: [{ path, content: canonical }],
              accessToken: runCtx.accessToken,
            });
            return { path, sha: result.sha };
          },
        },
      ];
    },
  };
}

// Ordem de EXECUÇÃO difere da ordem em que o pedido original lista os 6
// itens (branches antes dos commits) — de propósito, e por uma razão
// técnica inescapável: `createRepo` cria um repo bare vazio, SEM commit
// inicial, nos 3 providers (auto_init: false — "provisionado" precisa
// significar a mesma coisa nos 3). Uma ref sem nenhum commit não pode
// ser origem de `createBranch` (não há o que resolver). Os dois commits
// em `main` (template de PR, branching-policy) precisam vir PRIMEIRO —
// são eles que dão a `main` seu primeiro commit — só depois dev/qa/rc
// podem nascer a partir dela. O enum `bootstrap_step` no schema (ordem
// de declaração) não muda — não afeta nada, é só um conjunto de valores
// válidos, nunca comparado por ordem.
export const BOOTSTRAP_STEP_SEQUENCE: readonly BootstrapStep[] = [
  commitFileStep(
    'commit_pr_template',
    PR_TEMPLATE_PATH,
    prTemplateContent,
    'chore: adiciona template de PR',
  ),
  commitFileStep(
    'commit_branching_policy',
    BRANCHING_POLICY_PATH,
    branchingPolicyContent,
    'docs: adiciona política de branching',
  ),
  createBranchStep('create_dev_branch', 'dev', 'main'),
  createBranchStep('create_qa_branch', 'qa', 'dev'),
  // `create_rc_branch` saiu da sequência (achado #3), mas CONTINUA no enum
  // `bootstrap_step` do banco: bootstraps já rodados têm linhas com esse
  // valor, e apagá-lo do enum reescreveria história para tirar um passo que
  // realmente aconteceu. Passo que não está nesta lista simplesmente não é
  // executado nem cobrado pela retomada.
  protectBranchesStep,
];
