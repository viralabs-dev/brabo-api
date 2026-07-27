import { IsString, IsUUID } from 'class-validator';

export class BlockTaskInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  agentId!: string;

  @IsString()
  reason!: string;

  @IsString()
  diagnosis!: string;
}
