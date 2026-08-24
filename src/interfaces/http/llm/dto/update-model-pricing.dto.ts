import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * Preço em micro-USD por milhão de tokens, como o resto do módulo — nunca
 * float de dólar: somar 10⁻⁶ em ponto flutuante acumula erro que aparece na
 * fatura.
 */
export class UpdateModelPricingDto {
  @ApiProperty({
    example: 2_500_000,
    description: 'Price per million INPUT tokens, in micro-USD.',
  })
  @IsInt()
  @Min(0)
  inputPricePerMillionMicros!: number;

  @ApiProperty({
    example: 10_000_000,
    description: 'Price per million OUTPUT tokens, in micro-USD.',
  })
  @IsInt()
  @Min(0)
  outputPricePerMillionMicros!: number;
}
