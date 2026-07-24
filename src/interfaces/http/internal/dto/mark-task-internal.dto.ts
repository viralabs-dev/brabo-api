import { IsIn, IsString, IsUUID } from 'class-validator';

export class MarkTaskInternalDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  agentId!: string;

  @IsIn(['todo', 'in_progress', 'in_review', 'done'])
  status!: 'todo' | 'in_progress' | 'in_review' | 'done';
}
