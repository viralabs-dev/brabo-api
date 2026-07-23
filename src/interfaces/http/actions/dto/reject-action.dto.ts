import { IsOptional, IsString } from 'class-validator';

export class RejectActionDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
