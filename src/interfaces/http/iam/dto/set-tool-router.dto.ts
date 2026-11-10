import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/** Corpo de `PUT workspaces/:workspaceId/tool-router` (ADR 0179, ADR 0290, RN-625). */
export class SetToolRouterDto {
  @ApiPropertyOptional({
    enum: ['jev', 'laya', 'desligado'],
    example: 'jev',
    description:
      'Who chooses the tool of each agent step. `laya` needs the local GPU ' +
      'service to be proficient right now (409 `roteador_local_indisponivel` ' +
      'otherwise).',
  })
  @IsOptional()
  @IsIn(['jev', 'laya', 'desligado'])
  roteador?: 'jev' | 'laya' | 'desligado';

  @ApiPropertyOptional({
    example: false,
    description:
      'Legacy switch (AT-236): `true` is `jev`, `false` is `desligado`. ' +
      '`roteador` wins when both are sent.',
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
