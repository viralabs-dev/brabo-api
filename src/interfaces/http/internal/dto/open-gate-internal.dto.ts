import { IsString, IsUUID } from 'class-validator';

export class OpenGateInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  agentId!: string;
}
