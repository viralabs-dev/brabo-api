import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProvisionRepositoryDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsIn(['public', 'private'])
  visibility!: 'public' | 'private';

  @IsOptional()
  @IsString()
  namespace?: string;
}
