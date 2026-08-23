import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProvisionRepositoryDto {
  @ApiProperty({
    example: 'checkout',
    description: 'Repository name on the provider.',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: ['public', 'private'], example: 'private' })
  @IsIn(['public', 'private'])
  visibility!: 'public' | 'private';

  @ApiPropertyOptional({
    example: 'acme',
    description:
      "Organization or group. When omitted, the repository is created in " +
      "whoever registered the credential's personal account.",
  })
  @IsOptional()
  @IsString()
  namespace?: string;
}
