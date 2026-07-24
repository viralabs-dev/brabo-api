import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
} from 'class-validator';

export class RecordInfraGateVerdictInternalDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  prActionId!: string;

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
