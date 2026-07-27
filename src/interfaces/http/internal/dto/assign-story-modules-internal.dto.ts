import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta assign_story_modules do Arquiteto).
export class AssignStoryModulesInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ format: 'uuid', example: '01JC4Z0000HISTORIA000000001' })
  @IsUUID()
  storyId!: string;

  @ApiProperty({
    example: ['api', 'web'],
    description:
      'Nomes do `module_map` vigente. Módulo inexistente vira pendência de arquitetura.',
  })
  @IsArray()
  @IsString({ each: true })
  moduleIds!: string[];
}
