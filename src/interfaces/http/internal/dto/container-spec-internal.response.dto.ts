import { ApiProperty } from '@nestjs/swagger';
import { RecursosDoContainerResponseDto } from '../../containers/dto/containers.response.dto';
import type { PosturaDeRede } from '../../../../domain/containers/project-container';
import type { ProjectExecutionMode } from '../../../../domain/iam/project.entity';

export class ImagemParaOBrokerResponseDto {
  @ApiProperty({
    example: 'node:22-bookworm-slim',
    description: 'OCI reference with an explicit tag or digest.',
  })
  image!: string;

  @ApiProperty({ enum: ['none', 'egress'], example: 'none' })
  network!: PosturaDeRede;

  @ApiProperty({ type: RecursosDoContainerResponseDto })
  resources!: RecursosDoContainerResponseDto;
}

/**
 * WHERE the project folder is, said in a way the broker can resolve WITHOUT
 * any absolute path crossing the wire (RN-503).
 */
export class LocalizacaoDoProjetoResponseDto {
  @ApiProperty({
    enum: ['gerenciada', 'montada', 'indisponivel'],
    example: 'gerenciada',
    description:
      "Which of the broker's roots resolves this folder. `gerenciada` → " +
      '`PROJECT_WORKSPACES_HOST_ROOT` (the product-managed folder, named by ' +
      '`workspaceDirName`); `montada` → `BRABO_PROJECTS_HOST_BASE` (the ' +
      'single base of Mounted projects, ADR 0141); `indisponivel` → no root ' +
      'of this server reaches it, and `motivo` says why. Three states, not ' +
      'two: `runner` projects and legacy `mounted` projects created outside ' +
      'the base are refusals with DIFFERENT fixes, and collapsing them into ' +
      'a null would make the caller guess which one it got.',
  })
  tipo!: 'gerenciada' | 'montada' | 'indisponivel';

  @ApiProperty({
    example: 'loja',
    required: false,
    description:
      "The part the broker's root does NOT cover, joined to it as " +
      '`<root>/<segmento>`. For `gerenciada` it is `workspaceDirName`; for ' +
      '`montada`, the RELATIVE path under the base (it may contain `/`). ' +
      'ABSENT — not null — when `tipo` is `indisponivel`: the two variants ' +
      'are a discriminated union on the api side and the wire says the same ' +
      'thing, so a caller that reads `segmento` without checking `tipo` ' +
      'breaks loudly instead of composing `<root>/null`.',
  })
  segmento?: string;

  @ApiProperty({
    example: 'o projeto está no modo "runner"…',
    required: false,
    description:
      'Why no root reaches this folder. Present only when `tipo` is ' +
      '`indisponivel`. It is a message meant to be repeated back to whoever ' +
      'operates, so it names the mode or the base.',
  })
  motivo?: string;
}

/**
 * O que o BROKER precisa da api para compor a especificação de container ele
 * mesmo (ADR 0130). Não há `rationale` (it only exists so a human can review
 * the decision) and — deliberately — **no absolute path at all**: what crosses
 * the wire is a `localizacao`, the discriminated locator of RN-503.
 */
export class ContainerSpecInternalResponseDto {
  @ApiProperty({ example: 'f52be111-0000-4000-8000-000000000000' })
  projectId!: string;

  @ApiProperty({ example: 'exp002' })
  projectSlug!: string;

  @ApiProperty({ example: 'aaaaaaaa-0000-4000-8000-000000000000' })
  workspaceId!: string;

  @ApiProperty({
    example: 'exp002-f52be111',
    description:
      'Folder name FROZEN at project creation (RN-109). It is the single ' +
      'source of the container name (`brabo-<workspaceDirName>`) in ALL ' +
      'three modes. Where the FOLDER is is a different question, answered by ' +
      '`localizacao` (RN-503) — the api still never sends an absolute path, ' +
      'because a path from inside the api container is not a path the Docker ' +
      'daemon can resolve.',
  })
  workspaceDirName!: string;

  @ApiProperty({
    enum: ['container', 'mounted', 'runner'],
    example: 'container',
    description:
      'Where the code lives. The broker serves `container` AND `mounted` ' +
      '(RN-503): since ADR 0141 the mounted folder lives under one base this ' +
      'server mounts by identity, so the daemon reaches it. It still refuses ' +
      "`runner`: that folder is on the user's machine and no root here sees " +
      'it — there, the runner is what brings a container up (ADR 0137).',
  })
  executionMode!: ProjectExecutionMode;

  @ApiProperty({
    type: LocalizacaoDoProjetoResponseDto,
    description:
      'The discriminated locator of the project folder (RN-503): which of ' +
      "the broker's two roots resolves it, and the relative segment to join " +
      'to that root.',
  })
  localizacao!: LocalizacaoDoProjetoResponseDto;

  @ApiProperty({
    type: ImagemParaOBrokerResponseDto,
    nullable: true,
    description:
      '`null` while the Architect has not decided (RN-105) — `start` is then ' +
      'refused with 409 on the broker side, and the other four operations ' +
      'still work.',
  })
  imagem!: ImagemParaOBrokerResponseDto | null;

  @ApiProperty({
    example: 3,
    description:
      'Version of the current artifact; 0 when there is no decision. It ends ' +
      'up on the container as the `brabo.image.version` label.',
  })
  imagemVersao!: number;
}
