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
 * O que o BROKER precisa da api para compor a especificação de container ele
 * mesmo (ADR 0130). Não há `rationale` (it only exists so a human can review
 * the decision) and — deliberately — **no path at all**.
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
      'source of the container name (`brabo-<workspaceDirName>`), and the ' +
      'broker joins it with its OWN host root to get the bind source — the ' +
      'api never sends a path, because a path from inside the api container ' +
      'is not a path the Docker daemon can resolve.',
  })
  workspaceDirName!: string;

  @ApiProperty({
    enum: ['container', 'mounted', 'runner'],
    example: 'container',
    description:
      'Where the code lives. The broker refuses `mounted`/`runner`: that ' +
      "folder is on the user's machine and this host cannot see it — there, " +
      'the runner is what brings a container up.',
  })
  executionMode!: ProjectExecutionMode;

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
