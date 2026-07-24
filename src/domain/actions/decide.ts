import { roleAtLeast, type Role } from '../iam/role';
import type { PermissionPolicy, PermissionsFile } from './permissions-file';
import { matchesPattern, parseCommand } from './command-matcher';
import { isProtectedBranch } from './protected-branches';

export type ActionType =
  | 'terminal'
  | 'git_commit'
  | 'git_push'
  | 'pr_open'
  | 'spend'
  | 'git_repo_create'
  | 'git_branch_create'
  | 'git_branch_protect'
  | 'write_file'
  | 'open_adr_pr'
  | 'git_merge'
  | 'open_infra_pr';

export const ACTION_TYPES: readonly ActionType[] = [
  'terminal',
  'git_commit',
  'git_push',
  'pr_open',
  'spend',
  'git_repo_create',
  'git_branch_create',
  'git_branch_protect',
  'write_file',
  'open_adr_pr',
  'git_merge',
  'open_infra_pr',
];

const MIN_ROLE_FOR_ACTION_TYPE: Record<ActionType, Role> = {
  terminal: 'developer',
  git_commit: 'developer',
  git_push: 'maintainer',
  pr_open: 'maintainer',
  spend: 'owner',
  // Mutações do bootstrap de Gitflow (Fase 2, sessão 3) — calibrado igual
  // git_push, já que o endpoint de provisionamento já exige maintainer
  // (@RequireRole em git.controller.ts). Na prática o bootstrap nunca
  // passa por decide() (status nasce hardcoded auto_approved — ver
  // docs/adr/0005), mas o Record é exaustivo por tipo, então toda
  // ActionType precisa de uma entrada aqui mesmo assim.
  git_repo_create: 'maintainer',
  git_branch_create: 'maintainer',
  git_branch_protect: 'maintainer',
  // Escrita de arquivo por um agente fora da whitelist de paths (Fase 3a) —
  // calibrado como git_commit (developer): quem pode commitar pode propor
  // escrever um arquivo. Fica pending por padrão (sem regra em
  // permissions.json), pra o usuário aprovar.
  write_file: 'developer',
  // ADR commitado no repo do projeto + PR real aberta (Fase 3b — Arquiteto).
  // Calibrado como pr_open (maintainer): abre uma PR de verdade no provider.
  // Fica pending por padrão — o usuário aprova a ação (que então abre a PR) e
  // depois mergeia a PR real no provider.
  open_adr_pr: 'maintainer',
  // Merge de PR (Fase 4a). Merge com destino em branch protegida é SEMPRE
  // manual — a trava (teto em decide()) impede auto_approve independente da
  // configuração.
  git_merge: 'maintainer',
  // PR de infra (Fase 4a — InfraAgent): commita N arquivos (Dockerfiles/
  // compose/CI) e abre PR real, mesmo calibre de open_adr_pr (maintainer) —
  // fica pending por padrão, mas o accept-handoff do InfraAgent seeda
  // agent_autonomy auto_approve pra essa ação especificamente (o InfraAgent
  // NUNCA aplica nada, só propõe — auto-aprovar a PROPOSTA da PR é seguro).
  open_infra_pr: 'maintainer',
};

// Rede de segurança padrão, sempre ativa, independente do permissions.json
// do projeto (que começa vazio pra todo projeto novo) — comandos
// catastroficamente destrutivos continuam negados mesmo sem nenhuma regra
// jamais configurada. Pequena e não-exaustiva de propósito: não é um
// sandbox, é só o piso mínimo de segurança do critério de aceite.
export const BUILTIN_DENY_PATTERNS: readonly string[] = [
  'Terminal(rm -rf /)',
  'Terminal(rm -rf /*)',
  'Terminal(rm -fr /)',
];

export interface DecideAction {
  actionType: ActionType;
  command?: string; // só usado (e obrigatório em espírito) pra actionType === 'terminal'
  targetBranch?: string; // só usado pra actionType === 'git_merge' (trava de merge)
}

export interface DecideContext {
  effectiveRole: Role | null;
  autonomyMode: PermissionPolicy | null;
  permissionsFile: PermissionsFile;
}

export interface Decision {
  policy: PermissionPolicy;
  reason: string;
}

/**
 * Pura — todo IO (papel efetivo, linha de agent_autonomy, leitura do
 * permissions.json) já aconteceu antes de chamar isto; `ctx` só carrega o
 * resultado. Avalia em ordem (a) IAM, (b) agent_autonomy, (c)
 * permissions.json — deny em qualquer estágio vence na hora. Cada estágio
 * só pode SUBIR a permissividade do anterior: um estágio "silencioso"
 * (sem opinião — sem linha de autonomy, ou nenhum padrão do arquivo bateu
 * num comando simples) nunca rebaixa o que um estágio anterior já decidiu.
 */
export function decide(action: DecideAction, ctx: DecideContext): Decision {
  const minRole = MIN_ROLE_FOR_ACTION_TYPE[action.actionType];
  if (!ctx.effectiveRole || !roleAtLeast(ctx.effectiveRole, minRole)) {
    return {
      policy: 'deny',
      reason: `IAM insuficiente: "${action.actionType}" exige papel >= ${minRole}`,
    };
  }

  let current: Decision = {
    policy: 'require_approval',
    reason: 'default (sem regra aplicável)',
  };

  if (ctx.autonomyMode) {
    current = {
      policy: ctx.autonomyMode,
      reason: `agent_autonomy: ${ctx.autonomyMode}`,
    };
    if (current.policy === 'deny') return current;
  }

  const fileVerdict = decideFromPermissionsFile(action, ctx.permissionsFile);
  if (fileVerdict) {
    if (fileVerdict.policy === 'deny') return fileVerdict;
    current = fileVerdict;
  }

  // TETO da trava de merge (Fase 4a): merge com destino em branch protegida
  // NUNCA é auto-aprovável — nem agent_autonomy nem permissions.json
  // conseguem promovê-lo pra auto_approve. Aplicado por ÚLTIMO, sobre o
  // veredito já calculado (deny já teria retornado antes; require_approval
  // permanece). Ver domain/actions/protected-branches.ts.
  if (
    action.actionType === 'git_merge' &&
    action.targetBranch !== undefined &&
    isProtectedBranch(action.targetBranch) &&
    current.policy === 'auto_approve'
  ) {
    return {
      policy: 'require_approval',
      reason:
        'trava de merge: destino em branch protegida nunca é auto-aprovável',
    };
  }

  return current;
}

function decideFromPermissionsFile(
  action: DecideAction,
  file: PermissionsFile,
): Decision | null {
  const segments =
    action.actionType === 'terminal' && action.command
      ? parseCommand(action.command)
      : [[]];

  const perSegment = segments.map((tokens) =>
    matchAgainstFile(action.actionType, tokens, file),
  );

  const denyHit = perSegment.find((v) => v?.policy === 'deny');
  if (denyHit) return denyHit;

  if (segments.length > 1) {
    // Comando composto: um segmento sem regra nenhuma vira uma opinião
    // CONCRETA de require_approval (nunca silêncio) — é isso que impede
    // um allow parcial (só o primeiro pedaço aprovado) de promover o
    // comando inteiro pra auto_approve.
    const allAllow = perSegment.every((v) => v?.policy === 'auto_approve');
    if (allAllow) {
      return {
        policy: 'auto_approve',
        reason:
          'permissions.json: todos os segmentos do comando composto batem em allow',
      };
    }
    return {
      policy: 'require_approval',
      reason:
        'permissions.json: comando composto com ao menos um segmento não coberto por allow',
    };
  }

  return perSegment[0] ?? null;
}

function matchAgainstFile(
  actionType: ActionType,
  tokens: string[],
  file: PermissionsFile,
): Decision | null {
  const label = tokens.length > 0 ? tokens.join(' ') : actionType;
  const effectiveDeny = [...BUILTIN_DENY_PATTERNS, ...file.deny];

  if (effectiveDeny.some((p) => matchesPattern(p, actionType, tokens))) {
    return { policy: 'deny', reason: `permissions.json deny: ${label}` };
  }
  if (file.allow.some((p) => matchesPattern(p, actionType, tokens))) {
    return {
      policy: 'auto_approve',
      reason: `permissions.json allow: ${label}`,
    };
  }
  if (file.ask.some((p) => matchesPattern(p, actionType, tokens))) {
    return {
      policy: 'require_approval',
      reason: `permissions.json ask: ${label}`,
    };
  }
  return null;
}
