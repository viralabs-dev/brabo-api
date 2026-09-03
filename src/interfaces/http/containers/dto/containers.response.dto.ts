import { ApiProperty } from '@nestjs/swagger';
import type {
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../../domain/containers/project-container';
import {
  CONTAINER_LIFECYCLE_STATUSES,
  type ContainerLifecycleStatus,
} from '../../../../domain/containers/container-lifecycle';
import { ProposedActionResponseDto } from '../../actions/dto/actions.response.dto';

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
      'The module_map is all TypeScript over Node; the slim variant is enough and reduces surface.',
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
    description:
      'Id of the event that fixed the current decision, for auditing.',
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

  @ApiProperty({
    type: () => ObservacaoDeContainerResponseDto,
    nullable: true,
    description:
      'What the Docker daemon reports RIGHT NOW, asked through the broker ' +
      '(ADR 0130) — never fused with the fields above, which are what was ' +
      'RECORDED. A container killed from the outside shows up as recorded ' +
      '`running` and observed `exited`, and that is the point. `null` means ' +
      'either "there is no container" or "I could not look" — read ' +
      '`naoObservado` to tell them apart.',
  })
  observado!: ObservacaoDeContainerResponseDto | null;

  @ApiProperty({
    enum: [
      'broker-nao-configurado',
      'broker-sem-resposta',
      'broker-recusou',
      null,
    ],
    nullable: true,
    example: 'broker-nao-configurado',
    description:
      '`null` when the observation actually HAPPENED — including when it came ' +
      'back empty, which is the positive statement "I looked and there is no ' +
      'container". Filled in when there was no way to look, saying why. ' +
      'Inheriting the recorded state here is exactly what RN-468 forbids.',
  })
  naoObservado!:
    'broker-nao-configurado' | 'broker-sem-resposta' | 'broker-recusou' | null;

  @ApiProperty({
    nullable: true,
    example: null,
    description: "The broker's own message, when there was one.",
  })
  detalheDaObservacao!: string | null;
}

/**
 * O estado OBSERVADO — o que o daemon responde agora. Distinto de tudo o mais
 * nesta página: `EstadoDoContainerResponseDto` é a DECISÃO do Arquiteto e
 * `CicloDeVidaDoContainerResponseDto` é o REGISTRO da api. Os três respondem
 * perguntas diferentes e nenhum é recorte do outro.
 */
export class ObservacaoDeContainerResponseDto {
  @ApiProperty({ example: 'c0ffeebabe...' })
  containerId!: string;

  @ApiProperty({ example: 'brabo-exp002-f52be111' })
  nome!: string;

  @ApiProperty({
    enum: [
      'created',
      'running',
      'paused',
      'restarting',
      'removing',
      'exited',
      'dead',
    ],
    example: 'running',
    description: "The daemon's own state, with no translation and no collapse.",
  })
  estado!: string;

  @ApiProperty({ example: 'node:22-bookworm-slim' })
  imagem!: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: '`null` when the container has never started.',
  })
  iniciadoEm!: string | null;
}

/**
 * Uma linha da página global de containers (ADR 0136, RN-495) —
 * `GET workspaces/:workspaceId/containers`. Uma por projeto do workspace que
 * já tem `project_containers`; projeto sem linha nenhuma não aparece (não é
 * "vazio", é ausente — a mesma régua da rota `lifecycle` por projeto).
 */
export class ContainerOverviewItemResponseDto {
  @ApiProperty({ example: '01JC4Z0000PROJETO000001' })
  projectId!: string;

  @ApiProperty({ example: 'exp002' })
  projectName!: string;

  @ApiProperty({ example: 'exp002' })
  projectSlug!: string;

  @ApiProperty({
    enum: CONTAINER_LIFECYCLE_STATUSES,
    example: 'running',
    description: 'What was RECORDED (project_containers.status).',
  })
  status!: ContainerLifecycleStatus;

  @ApiProperty({ example: 1 })
  imageVersion!: number;

  @ApiProperty({
    nullable: true,
    example: 'node:22-bookworm-slim',
    description:
      'The image FROZEN at `imageVersion`, resolved from the ' +
      '`artifact.project_image` event at that exact version — never the ' +
      'current one, which may have been revised since. `null` when that ' +
      "version's event could not be found.",
  })
  imagem!: string | null;

  @ApiProperty({ type: RecursosDoContainerResponseDto })
  resources!: RecursosDoContainerResponseDto;

  @ApiProperty({ nullable: true, example: null })
  failureReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  statusChangedAt!: string;

  @ApiProperty({
    type: () => ObservacaoDeContainerResponseDto,
    nullable: true,
    description:
      'What the broker reports right now — `null` either because there is ' +
      'no container, because it could not be asked (`naoObservado`), or ' +
      'because this row was not asked this load (`naoVerificado`).',
  })
  observado!: ObservacaoDeContainerResponseDto | null;

  @ApiProperty({
    enum: [
      'broker-nao-configurado',
      'broker-sem-resposta',
      'broker-recusou',
      null,
    ],
    nullable: true,
  })
  naoObservado!:
    'broker-nao-configurado' | 'broker-sem-resposta' | 'broker-recusou' | null;

  @ApiProperty({ nullable: true, example: null })
  detalheDaObservacao!: string | null;

  @ApiProperty({
    enum: [
      'fora_do_escopo_da_verificacao',
      'teto_de_verificacoes_atingido',
      null,
    ],
    nullable: true,
    example: null,
    description:
      'Non-null when this row was NOT asked of the broker this load — never ' +
      'confused with `naoObservado`, which means it WAS asked and failed. ' +
      '`fora_do_escopo_da_verificacao`: status is `stopped`/`failed`/`removed`, ' +
      'where daemon confirmation does not matter. ' +
      '`teto_de_verificacoes_atingido`: eligible, but the per-load broker ' +
      'call budget was already spent by other rows.',
  })
  naoVerificado!:
    'fora_do_escopo_da_verificacao' | 'teto_de_verificacoes_atingido' | null;

  @ApiProperty({
    type: () => ProposedActionResponseDto,
    nullable: true,
    description:
      'The pending `container_start`/`container_stop`/`container_remove` ' +
      'action for this project, if any — in ANY of its sessions. The page ' +
      'renders the inline `ApprovalCard` for it instead of the action ' +
      'button, same pattern as the PRs tab.',
  })
  acaoPendente!: ProposedActionResponseDto | null;
}
