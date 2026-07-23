import { IsOptional, IsString } from 'class-validator';

export class DenyActionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
