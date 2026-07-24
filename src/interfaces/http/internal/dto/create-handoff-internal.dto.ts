import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine: o Criativo oferece o handoff ao PO ao emitir o
// product_brief. `artifactId` é o session_events.id (ULID) do artefato.
export class CreateHandoffInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  fromAgent!: string;

  @IsString()
  toAgent!: string;

  @IsOptional()
  @IsString()
  artifactId?: string;
}
