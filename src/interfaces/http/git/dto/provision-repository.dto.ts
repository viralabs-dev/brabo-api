import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProvisionRepositoryDto {
  @ApiProperty({
    example: 'checkout',
    description: 'Nome do repositório no provider.',
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
      'Organização ou grupo. Omitido, o repositório nasce na conta pessoal de quem ' +
      'registrou a credencial.',
  })
  @IsOptional()
  @IsString()
  namespace?: string;
}
