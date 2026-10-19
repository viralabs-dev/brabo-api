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
    description: 'A name for you to recognize this token later — not unique.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    example: 90,
    description:
      'Expires in N days. Omitted = no expiration (revocable at any time, but never expires on its own).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expiresInDays?: number;
}
