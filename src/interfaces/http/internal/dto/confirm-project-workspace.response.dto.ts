import { ApiProperty } from '@nestjs/swagger';

/**
 * Resultado de confirmar o workspace de um projeto `execution_mode: runner`
 * (RN-423, ADR 0104).
 */
export class ConfirmProjectWorkspaceResponseDto {
  @ApiProperty({
    example: true,
    description:
      'Sempre `true` quando a chamada não lançou — a confirmação é ' +
      'idempotente. `changed` diz se ALGO mudou nesta chamada.',
  })
  verified!: boolean;

  @ApiProperty({
    example: '/home/voce/projetos/loja',
    description:
      'O caminho GRAVADO (normalizado) — pode diferir do que a criação ' +
      'tinha, porque o runner é a fonte da verdade e sobrescreve.',
  })
  workspacePath!: string;

  @ApiProperty({
    example: true,
    description:
      '`true` na primeira confirmação, ou quando o caminho reportado é ' +
      'DIFERENTE do que já estava gravado. `false` numa reconexão que ' +
      'reporta o mesmo caminho de sempre — nada foi regravado.',
  })
  changed!: boolean;
}
