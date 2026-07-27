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
    description: 'ULID da ação.',
  })
  id!: string;

  @ApiProperty({ example: '01JC4Z0000PROJETO0000000001' })
  projectId!: string;

  @ApiProperty({ example: '01JC4Z8QK3M7YV2N5T9B0PXHRA' })
  sessionId!: string;

  @ApiProperty({
    example: 7,
    description: 'Ordem da ação dentro da sessão; serve de cursor na listagem.',
  })
  seq!: number;

  @ApiProperty({
    enum: ACTION_TYPES,
    example: 'terminal',
    description:
      'O que a ação faria. `git_push` e `git_merge` exigem `maintainer`.',
  })
  actionType!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { command: 'pnpm test' },
    description: 'Parâmetros da ação, específicos do `actionType`.',
  })
  payload!: unknown;

  @ApiProperty({
    enum: ACTION_STATUSES,
    example: 'pending',
    description:
      'Estado no pipeline. `auto_approved` é distinto de `approved` de propósito: ' +
      'o log precisa distinguir o que uma pessoa decidiu do que a política liberou.',
  })
  status!: ActionStatus;

  @ApiProperty({
    enum: ['auto_approve', 'require_approval', 'deny'],
    example: 'require_approval',
    description:
      'O que o `permissions.json` decidiu para esta ação. `deny` SEMPRE vence ' +
      '`allow` — nem a autonomia do agente reverte.',
  })
  resolvedPolicy!: Wire<ProposedAction>['resolvedPolicy'];

  @ApiProperty({ type: ActorResponseDto, description: 'Quem propôs.' })
  actor!: ActorResponseDto;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Id do usuário que aprovou ou negou. Nunca um agente.',
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
      'Resultado da execução, com forma específica de cada `actionType` — saída e ' +
      'código de saída no terminal, número e URL do PR nos tipos de git. `null` ' +
      'enquanto a ação não foi executada.',
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
      'Passe como `afterSeq` na próxima página; `null` é fim da lista.',
  })
  nextCursor!: number | null;
}
export const _chavesPaginaAcoes: MesmasChaves<
  PaginaDeAcoesResponseDto,
  Page<ProposedAction>
> = true;

/** O `permissions.json` do projeto, como ele está em disco. */
export class PermissionsFileResponseDto implements Wire<PermissionsFile> {
  @ApiProperty({
    example: ['Terminal(pnpm test:*)', 'Terminal(pnpm lint)'],
    description: 'Padrões aprovados automaticamente.',
  })
  allow!: string[];

  @ApiProperty({
    example: ['Terminal(rm -rf *)', 'Terminal(git push --force*)'],
    description:
      'Padrões proibidos. `deny` vence `allow` e vence a autonomia do agente — ' +
      'não há combinação de configuração que libere o que está aqui.',
  })
  deny!: string[];

  @ApiProperty({
    example: ['Terminal(pnpm add *)'],
    description: 'Padrões que sempre pedem decisão humana.',
  })
  ask!: string[];
}
export const _chavesPermissoes: MesmasChaves<
  PermissionsFileResponseDto,
  PermissionsFile
> = true;

/** Uma linha da tabela de autonomia: o que este agente pode fazer sozinho. */
type RegraDeAutonomia = {
  agentId: string;
  actionType: string;
  mode: PermissionPolicy;
};

export class AgentAutonomyRuleResponseDto implements RegraDeAutonomia {
  @ApiProperty({ example: 'dev-api', description: 'Slug do agente.' })
  agentId!: string;

  @ApiProperty({ enum: ACTION_TYPES, example: 'terminal' })
  actionType!: string;

  @ApiProperty({
    enum: ['auto_approve', 'require_approval', 'deny'],
    example: 'auto_approve',
    description:
      'Autonomia concedida. Não sobrepõe o `permissions.json`: um `deny` de lá ' +
      'continua vencendo.',
  })
  mode!: PermissionPolicy;
}
export const _chavesAutonomia: MesmasChaves<
  AgentAutonomyRuleResponseDto,
  RegraDeAutonomia
> = true;
