import { ApiProperty } from '@nestjs/swagger';
import type { ProjetoAtendidoPeloRunner } from '../../../../application/use-cases/runner/list-runner-projects.use-case';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/**
 * Uma linha de `GET /runner/projects` (RN-543, ADR 0154 ponto 3) — o que o
 * agente local de MÁQUINA precisa saber de cada projeto que atende.
 *
 * Com as duas travas de tipo (`Wire`/`MesmasChaves`): esta lista é a ÚNICA
 * fonte do que o agente vai abrir conexão para atender, e um campo que
 * divergisse do caso de uso apareceria como uma conexão a menos, em silêncio.
 *
 * Nunca carrega o caminho ABSOLUTO da pasta: o que viaja é o SEGMENTO
 * (`workspaceDirName`), e a raiz é de quem executa — o mesmo invariante do
 * broker (ADR 0144) e da base do runner (ADR 0151).
 */
export class RunnerProjectResponseDto implements Wire<ProjetoAtendidoPeloRunner> {
  @ApiProperty({ example: '01JC4Z0000PROJETO000000001' })
  projectId!: string;

  @ApiProperty({ example: 'Brabo' })
  name!: string;

  @ApiProperty({
    example: 'brabo-01jc4z',
    description:
      'The project folder name (RN-109) — a relative segment under the ' +
      'machine base, never an absolute path.',
  })
  workspaceDirName!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'When the runner first confirmed the folder (RN-423). Null = never ' +
      'confirmed. It records a confirmation, not a heartbeat (RN-468): it ' +
      'does not say the folder is up now.',
  })
  workspaceVerifiedAt!: string | null;
}

export const _chavesRunnerProject: MesmasChaves<
  RunnerProjectResponseDto,
  ProjetoAtendidoPeloRunner
> = true;
