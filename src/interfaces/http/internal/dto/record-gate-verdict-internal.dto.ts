import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
} from 'class-validator';

export class RecordGateVerdictInternalDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  taskId!: string;

  @IsIn(['qa', 'secops'])
  gate!: 'qa' | 'secops';

  @IsIn(['approved', 'changes_requested'])
  veredito!: 'approved' | 'changes_requested';

  @IsString()
  resumo!: string;

  @IsArray()
  @IsString({ each: true })
  itens!: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  maxCorrections?: number;
}
