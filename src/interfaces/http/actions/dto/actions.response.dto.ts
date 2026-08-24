import { ApiProperty } from '@nestjs/swagger';
import { ActorResponseDto } from '../../shared/dto/comuns.response.dto';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type { ProposedAction } from '../../../../domain/actions/proposed-action.entity';
import type {
  PermissionPolicy,
  PermissionsFile,
} from '../../../../domain/actions/permissions-file';
import {
  ACTION_STATUSES,
  type ActionStatus,
} from '../../../../domain/actions/action-state-machine';
import { ACTION_TYPES } from '../../../../domain/actions/decide';
import type { Page } from '../../../../application/ports/proposed-action-repository.port';

/**
 * Respostas do pipeline de aprovação (Fase 7b, item 6).
 *
 * `executionResult` é uma união de SEIS formas (terminal, bootstrap de git, PR
 * de ADR, ação de git, PR de infra, patch de instrução). Escrever as seis
 * seria duplicar domínio que já muda sozinho; o campo é declarado por acesso
 * indexado ao `Wire<ProposedAction>`, que fica em dia de graça, e o
 * `@ApiProperty` carrega a explicação em prosa. Uma união fechada aqui
 * apodreceria na primeira forma nova.
 */

export class ProposedActionResponseDto implements Wire<ProposedAction> {
  @ApiProperty({
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRC',
    description: 'ULID of the action.',
  })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  sessionId!: string;

  @ApiProperty({
    example: 7,
    description:
      'Order of the action within the session; used as a cursor in listings.',
  })
  seq!: number;

  @ApiProperty({
    enum: ACTION_TYPES,
    example: 'terminal',
    description:
      'What the action would do. `git_push` and `git_merge` require `maintainer`.',
  })
  actionType!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { command: 'pnpm test' },
    description: 'Parameters of the action, specific to the `actionType`.',
  })
  payload!: unknown;

  @ApiProperty({
    enum: ACTION_STATUSES,
    example: 'pending',
    description:
      'State in the pipeline. `auto_approved` is distinct from `approved` on ' +
      'purpose: the log needs to distinguish what a person decided from what ' +
      'the policy released.',
  })
  status!: ActionStatus;

  @ApiProperty({
    enum: ['auto_approve', 'require_approval', 'deny'],
    example: 'require_approval',
    description:
      'What `permissions.json` decided for this action. `deny` ALWAYS wins over ' +
      "`allow` — not even the agent's autonomy overrides it.",
  })
  resolvedPolicy!: Wire<ProposedAction>['resolvedPolicy'];

  @ApiProperty({ type: ActorResponseDto, description: 'Who proposed it.' })
  actor!: ActorResponseDto;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Id of the user who approved or denied it. Never an agent.',
  })
  decidedBy!: string | null;

  @ApiProperty({ example: null, format: 'date-time', nullable: true })
  decidedAt!: string | null;

  @ApiProperty({ example: null, nullable: true })
  rejectionReason!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description:
      'Execution result, with a shape specific to each `actionType` — output and ' +
      'exit code for terminal, PR number and URL for the git types. `null` while ' +
      'the action has not been executed.',
  })
  executionResult!: Wire<ProposedAction>['executionResult'];

  @ApiProperty({ example: '2026-07-27T14:33:10.900Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-27T14:33:10.900Z', format: 'date-time' })
  updatedAt!: string;
}
export const _chavesAcao: MesmasChaves<
  ProposedActionResponseDto,
  ProposedAction
> = true;

export class PaginaDeAcoesResponseDto implements Wire<Page<ProposedAction>> {
  @ApiProperty({ type: [ProposedActionResponseDto] })
  items!: ProposedActionResponseDto[];

  @ApiProperty({
    example: 7,
    nullable: true,
    description:
      'Pass as `afterSeq` on the next page; `null` means end of list.',
  })
  nextCursor!: number | null;
}
export const _chavesPaginaAcoes: MesmasChaves<
  PaginaDeAcoesResponseDto,
  Page<ProposedAction>
> = true;

/** The project's `permissions.json`, as it is on disk. */
export class PermissionsFileResponseDto implements Wire<PermissionsFile> {
  @ApiProperty({
    example: ['Terminal(pnpm test:*)', 'Terminal(pnpm lint)'],
    description: 'Automatically approved patterns.',
  })
  allow!: string[];

  @ApiProperty({
    example: ['Terminal(rm -rf *)', 'Terminal(git push --force*)'],
    description:
      "Forbidden patterns. `deny` wins over `allow` and over the agent's " +
      'autonomy — no configuration combination releases what is listed here.',
  })
  deny!: string[];

  @ApiProperty({
    example: ['Terminal(pnpm add *)'],
    description: 'Patterns that always require a human decision.',
  })
  ask!: string[];
}
export const _chavesPermissoes: MesmasChaves<
  PermissionsFileResponseDto,
  PermissionsFile
> = true;

/** A row of the autonomy table: what this agent can do on its own. */
type RegraDeAutonomia = {
  agentId: string;
  actionType: string;
  mode: PermissionPolicy;
};

export class AgentAutonomyRuleResponseDto implements RegraDeAutonomia {
  @ApiProperty({ example: 'dev-api', description: 'Agent slug.' })
  agentId!: string;

  @ApiProperty({
    example: 'terminal',
    description:
      'The action type, or `"*"` — "auto mode" (RN-153): autonomy for ANY ' +
      'action type of this agent.',
  })
  actionType!: string;

  @ApiProperty({
    enum: ['auto_approve', 'require_approval', 'deny'],
    example: 'auto_approve',
    description:
      'Autonomy granted. Does not override `permissions.json`: a `deny` there ' +
      'still wins.',
  })
  mode!: PermissionPolicy;
}
export const _chavesAutonomia: MesmasChaves<
  AgentAutonomyRuleResponseDto,
  RegraDeAutonomia
> = true;
