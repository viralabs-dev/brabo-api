import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

/** Corpo de `POST /internal/projects/:projectId/tasks/:taskId/auto-merge` (RN-1316). */
export class AutoMergeInternalDto {
  @ApiProperty({
    description:
      'The session of the task that just resolved its gate; the `git_merge` is proposed in it.',
  })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;
}
