import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

export class IssuePatRequestDto {
  @ApiProperty({
    example: 'laptop',
    description: 'Nome pra você reconhecer este token depois — não é único.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: 90,
    description:
      'Expira em N dias. Omitido = sem expiração (revogável a qualquer hora, mas nunca expira sozinho).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
