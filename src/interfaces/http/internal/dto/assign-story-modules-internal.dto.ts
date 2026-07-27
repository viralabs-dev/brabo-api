import { IsArray, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta assign_story_modules do Arquiteto).
export class AssignStoryModulesInternalDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  storyId!: string;

  @IsArray()
  @IsString({ each: true })
  moduleIds!: string[];
}
