import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ConfirmProjectWorkspaceInternalDto {
  @ApiProperty({
    example: '/home/you/projects/store',
    description:
      'Absolute path confirmed by the runner ON THE HOST — the source of ' +
      'truth (RN-423). Re-validated LEXICALLY here before writing; invalid ' +
      'is 400, never written.',
  })
  @IsString()
  path!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000SESSAO00000000001',
    description:
      "The project's most recent session (`ProjectSession.latest_id/1`), " +
      "resolved on the engine side. `null`/omitted when the project doesn't " +
      'have any session yet — the project is still updated, only the audit ' +
      'event is skipped (accepted gap, RN-423).',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '01JC4Z0000USUARIO0000000001',
    description:
      "Who requested the runner ticket (owner of the socket that " +
      'confirmed) — becomes the actor of the `project.workspace_verified` ' +
      'event. Omitted: the event (if there is a session) is born with no ' +
      'identified actor.',
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;
}
