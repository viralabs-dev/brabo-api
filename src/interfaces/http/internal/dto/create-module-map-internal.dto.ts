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
        responsibility: 'Rules and HTTP',
        dependsOn: ['db'],
      },
    ],
    description:
      'Module graph. A CYCLE makes the map get rejected with 400 — the validation is domain-level.',
  })
  @IsArray()
  modules!: ModuleNode[];
}
