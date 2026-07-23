import { IsUUID } from 'class-validator';

export class SetModelBindingDto {
  @IsUUID()
  modelId!: string;
}
