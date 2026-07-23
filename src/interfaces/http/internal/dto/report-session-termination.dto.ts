import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportSessionTerminationDto {
  @IsUUID()
  projectId!: string;

  @IsIn(['closed', 'closed_abnormally'])
  to!: 'closed' | 'closed_abnormally';

  @IsOptional()
  @IsString()
  reason?: string;
}
