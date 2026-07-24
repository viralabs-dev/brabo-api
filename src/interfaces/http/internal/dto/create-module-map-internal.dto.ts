import { IsArray, IsUUID } from 'class-validator';
import type { ModuleNode } from '../../../../domain/architecture/module-graph';

// Chamada interna do engine (ferramenta create_module_map do Arquiteto). A
// validação de ciclo é de domínio (CreateModuleMapUseCase).
export class CreateModuleMapInternalDto {
  @IsUUID()
  projectId!: string;

  @IsArray()
  modules!: ModuleNode[];
}
