import { IsString } from 'class-validator';

export class AcceptParallelizationDto {
  @IsString()
  module!: string;
}
