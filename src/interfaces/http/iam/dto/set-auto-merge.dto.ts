import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Corpo de `PUT .../auto-merge` (RN-1316, AT-902). Rota própria, fora do `UpdateProjectDto`. */
export class SetAutoMergeDto {
  @ApiProperty({
    example: true,
    description:
      'Turns the auto-merge switch on (`true`, workspace `owner` only) or off ' +
      '(`false`, `maintainer` is enough). Required: an omitted key is a 400, ' +
      'never an implicit "off".',
  })
  @IsBoolean()
  habilitado!: boolean;
}
