import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty } from 'class-validator';

export class DecideBootstrapPlanDto {
  @ApiProperty({
    example: '2026-08-01T23:45:00.000Z',
    format: 'date-time',
    description:
      'O `generatedAt` do plano que você VIU. Guarda otimista: se o plano ' +
      'tiver sido regerado desde então (readoção, ou o repositório mudou), a ' +
      'decisão é recusada com 409 em vez de aplicar um "sim" dado sobre outra ' +
      'coisa.',
  })
  @IsISO8601()
  @IsNotEmpty()
  planGeneratedAt!: string;
}
