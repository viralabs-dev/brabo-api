import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';
import type { ModuleNode } from '../../../../domain/architecture/module-graph';

// Chamada interna do engine (ferramenta create_module_map do Arquiteto). A
// validação de ciclo é de domínio (CreateModuleMapUseCase).
export class CreateModuleMapInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    example: [
      {
        name: 'api',
        stack: 'NestJS',
        responsibility: 'Regras e HTTP',
        dependsOn: ['db'],
      },
    ],
    description:
      'Grafo de módulos. CICLO faz o mapa ser rejeitado com 400 — a validação é de domínio.',
  })
  @IsArray()
  modules!: ModuleNode[];
}
