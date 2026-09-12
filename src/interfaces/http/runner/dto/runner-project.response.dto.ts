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
      'O nome da pasta do projeto (RN-109) — segmento relativo sob a base ' +
      'da máquina, nunca um caminho absoluto.',
  })
  workspaceDirName!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Quando o runner confirmou a pasta pela primeira vez (RN-423). Nulo = ' +
      'nunca confirmada. É registro de uma confirmação, não batimento ' +
      '(RN-468): não diz que a pasta está de pé agora.',
  })
  workspaceVerifiedAt!: string | null;
}

export const _chavesRunnerProject: MesmasChaves<
  RunnerProjectResponseDto,
  ProjetoAtendidoPeloRunner
> = true;
