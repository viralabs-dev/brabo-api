import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ReportSessionTerminationDto {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
