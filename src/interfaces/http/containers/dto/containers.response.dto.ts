import { ApiProperty } from '@nestjs/swagger';
import type {
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../../domain/containers/project-container';
import {
  CONTAINER_LIFECYCLE_STATUSES,
  type ContainerLifecycleStatus,
} from '../../../../domain/containers/container-lifecycle';

export class RecursosDoContainerResponseDto implements RecursosDoContainer {
  @ApiProperty({ example: 2, description: 'CPUs, fractional value allowed.' })
  cpus!: number;

  @ApiProperty({ example: 4096, description: 'Memory in MiB.' })
  memoryMb!: number;

  @ApiProperty({
    example: 512,
    description:
      'Process cap. This is what contains a fork bomb without depending on a verb allowlist.',
  })
  pidsLimit!: number;
}

export class DecisaoDeImagemResponseDto {
  @ApiProperty({
    example: 'node:22-bookworm-slim',
    description:
      'OCI reference with an explicit TAG or digest. `latest` is refused: the ' +
      'artifact needs to say the same thing six months from now.',
  })
  image!: string;

  @ApiProperty({
    example:
      "The module_map is all TypeScript over Node; the slim variant is enough and reduces surface.",
    description: 'Why THIS image. This is what makes the decision reviewable.',
  })
  rationale!: string;

  @ApiProperty({
    enum: ['none', 'egress'],
    example: 'none',
    description:
      "The container's network posture, decided ONCE in the artifact and not " +
      'command by command. `egress` is cost and surface: the Architect asks, ' +
      'the user authorizes it at provisioning time.',
  })
  network!: PosturaDeRede;

  @ApiProperty({ type: RecursosDoContainerResponseDto })
  resources!: RecursosDoContainerResponseDto;
}

export class EstadoDoContainerResponseDto {
  @ApiProperty({
    enum: ['sem_decisao', 'decidido'],
    example: 'sem_decisao',
    description:
      '`sem_decisao` is the initial state of every project and is what closes ' +
      "the RN-105 gate: no image means no container, and the Code tab doesn't open.",
  })
  status!: 'sem_decisao' | 'decidido';

  @ApiProperty({
    type: DecisaoDeImagemResponseDto,
    nullable: true,
    description: 'The current decision, or `null` when there is none yet.',
  })
  decisao!: DecisaoDeImagemResponseDto | null;

  @ApiProperty({
    example: 0,
    description:
      'Version of the current artifact; 0 when there is no decision. Revising ' +
      'means issuing a new version — history is never rewritten.',
  })
  version!: number;

  @ApiProperty({
    nullable: true,
    example: '01JC4Z0000EVENTO000000001',
    description: 'Id of the event that fixed the current decision, for auditing.',
  })
  eventId!: string | null;

  @ApiProperty({ nullable: true, format: 'date-time' })
  decidedAt!: string | null;
}

export class ImagemDecididaResponseDto {
  @ApiProperty({ type: DecisaoDeImagemResponseDto })
  decisao!: DecisaoDeImagemResponseDto;

  @ApiProperty({ example: 1 })
  version!: number;
}

/**
 * O ESTADO do ciclo de vida do container (ADR 0081/0083, RN-243..248) —
 * distinto de `EstadoDoContainerResponseDto`, que é a DECISÃO de imagem do
 * Arquiteto. `null` no corpo da resposta (fora desta classe, ver o
 * controller) é o estado honesto de "nunca provisionado": nenhum processo do
 * produto hoje transiciona `project_containers` de verdade (RN-267), então
 * é o resultado esperado para a maioria dos projetos.
 */
export class CicloDeVidaDoContainerResponseDto {
  @ApiProperty({
    enum: CONTAINER_LIFECYCLE_STATUSES,
    example: 'provisioning',
    description:
      'What was RECORDED, not what a Docker daemon confirms — no real ' +
      'orchestrator transitions this table today (RN-243).',
  })
  status!: ContainerLifecycleStatus;

  @ApiProperty({
    example: 1,
    description:
      'Version of `artifact.project_image` FROZEN at the first transition ' +
      '(RN-245) — not reapplied on every read.',
  })
  imageVersion!: number;

  @ApiProperty({
    type: RecursosDoContainerResponseDto,
    description: 'Cap DECLARED at provisioning time — not enforced (RN-248).',
  })
  resources!: RecursosDoContainerResponseDto;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Only populated on a transition to `failed`.',
  })
  failureReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  statusChangedAt!: string;
}
