import type {
  BootstrapDiagnostic,
  BootstrapPlan,
  BootstrapPlanStep,
} from '../../../domain/git/repo-bootstrap.entity';
import {
  BOOTSTRAP_STEP_SEQUENCE,
  TEMPLATE_BRANCH_NAMES,
  type BootstrapStepCtx,
} from './bootstrap-steps';

/**
 * O DRY-RUN do bootstrap (Fase 12a): o que ele FARIA, sem fazer nada.
 *
 * Não é um diagnóstico novo — é a serialização do que `check()` já
 * devolve. Cada passo do bootstrap sabe, desde a Fase 2, listar suas
 * mutações pendentes relendo o estado REMOTO (é isso que dá idempotência
 * e retomada, ver docs/adr/0005); aqui a mesma lista vira um plano
 * legível em vez de virar execução. `mutation.run` nunca é chamado, e é
 * essa ausência que o spec deste módulo protege com um provider cujos
 * métodos de escrita lançam se alguém os tocar.
 *
 * Função livre, sem classe e sem DI, no mesmo estilo de
 * `bootstrap-templates.ts` — recebe o contexto e devolve dado puro.
 */
export async function planBootstrap(
  ctx: BootstrapStepCtx,
): Promise<BootstrapPlan> {
  const steps: BootstrapPlanStep[] = [];
  const diagnostics: BootstrapDiagnostic[] = [];
  let protecaoSuportada = true;

  for (const step of BOOTSTRAP_STEP_SEQUENCE) {
    const pending = await step.check(ctx);

    if (pending === 'capability_unsupported') {
      // Degrada com aviso, nunca falha — mesma regra do runner.
      protecaoSuportada = false;
      diagnostics.push({
        kind: 'capability_unsupported',
        detail: { step: step.step, provider: ctx.provider.name },
      });
      continue;
    }

    for (const mutation of pending) {
      steps.push({
        step: step.step,
        actionType: mutation.actionType,
        payload: mutation.payload,
      });
      diagnostics.push(diagnosticFor(mutation.actionType, mutation.payload));
    }
  }

  if (protecaoSuportada) {
    for (const entrada of protecoesDasBranchesPlanejadas(steps)) {
      steps.push(entrada);
      diagnostics.push(diagnosticFor(entrada.actionType, entrada.payload));
    }
  }

  diagnostics.push(...(await extraBranchDiagnostics(ctx)));

  return { generatedAt: new Date().toISOString(), steps, diagnostics };
}

/**
 * As proteções que `check()` NÃO consegue enxergar.
 *
 * `protect_branches.check()` lê o estado remoto de AGORA, então uma
 * branch que o próprio plano vai criar (dev/qa/rc num repo que não as
 * tem) ainda não existe para ser listada como desprotegida — mas na
 * execução ela vai existir, porque os passos de criação rodam antes, e
 * o bootstrap vai protegê-la.
 *
 * Sem esta passada o plano prometeria MENOS do que a execução faria, e a
 * garantia da RN-045 ("nada é protegido fora do plano aprovado") viraria
 * letra morta justamente no caso mais comum de adoção. O plano tem que
 * prometer a mais, nunca a menos: uma branch que entre a aprovação e a
 * execução já apareça protegida é simplesmente pulada pelo runner.
 */
function protecoesDasBranchesPlanejadas(
  steps: BootstrapPlanStep[],
): BootstrapPlanStep[] {
  const aCriar = new Set(
    steps
      .filter((s) => s.actionType === 'git_branch_create')
      .map((s) => s.payload.branchName),
  );
  const jaNoPlano = new Set(
    steps
      .filter((s) => s.actionType === 'git_branch_protect')
      .map((s) => s.payload.branchName),
  );

  // Ordem do template (main, rc, qa, dev), a mesma que o runner usa.
  return TEMPLATE_BRANCH_NAMES.filter(
    (nome) => aCriar.has(nome) && !jaNoPlano.has(nome),
  ).map((branchName) => ({
    step: 'protect_branches' as const,
    actionType: 'git_branch_protect',
    payload: { branchName },
  }));
}

/**
 * Cada tipo de mutação pendente é, do ponto de vista de quem lê o plano,
 * uma divergência entre o repositório e o template — o mesmo fato dito
 * na linguagem da tela em vez da linguagem do executor.
 */
function diagnosticFor(
  actionType: string,
  payload: Record<string, unknown>,
): BootstrapDiagnostic {
  if (actionType === 'git_branch_create') {
    return { kind: 'missing_branch', detail: payload };
  }
  if (actionType === 'git_branch_protect') {
    return { kind: 'unprotected_branch', detail: payload };
  }
  return { kind: 'missing_file', detail: payload };
}

/**
 * Branches que o template NÃO conhece (ex.: `develop`, `release/1.2`).
 *
 * Puramente informativo: não vira passo, não bloqueia nada, e o
 * bootstrap jamais as apaga — um repositório adotado tem a política que
 * tem, e o produto registra isso em vez de impor a sua (Fase 12a). É a
 * única parte do plano que `check()` não fornece, porque o executor não
 * tem motivo para olhar branch que ele não gerencia.
 */
async function extraBranchDiagnostics(
  ctx: BootstrapStepCtx,
): Promise<BootstrapDiagnostic[]> {
  const branches = await ctx.provider.listBranches({
    externalId: ctx.externalId,
    accessToken: ctx.accessToken,
  });

  return branches
    .filter((b) => !TEMPLATE_BRANCH_NAMES.includes(b.name))
    .map((b) => ({
      kind: 'extra_branch' as const,
      detail: { branchName: b.name, protected: b.protected },
    }));
}
