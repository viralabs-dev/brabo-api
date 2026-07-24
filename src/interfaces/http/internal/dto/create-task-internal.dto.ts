import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_task do PO).
export class CreateTaskInternalDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  storyId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
