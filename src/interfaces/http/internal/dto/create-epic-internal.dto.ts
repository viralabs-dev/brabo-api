import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_epic do PO).
export class CreateEpicInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
