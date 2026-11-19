import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Corpo de `PUT /projects/:id/automacoes/:categoria/:chave` (RN-1421, AT-994). */
export class SetAutomacaoDto {
  @ApiProperty({
    example: false,
    description:
      'Turns the automation on or off. Required: an omitted key is a 400.',
  })
  @IsBoolean()
  ligada!: boolean;
}

/**
 * Corpo de `POST /projects/:id/automacoes`: a resposta à oferta
 * `automacao.oferecida` (AT-998). `categoria`/`chave`/`escopo` são os do
 * payload do evento, devolvidos como vieram.
 */
export class ResponderOfertaDto {
  @ApiProperty({ enum: ['aprovacao', 'handoff', 'desbloqueio'] })
  @IsIn(['aprovacao', 'handoff', 'desbloqueio'])
  categoria!: 'aprovacao' | 'handoff' | 'desbloqueio';

  @ApiProperty({ example: 'container_start' })
  @IsString()
  @MaxLength(200)
  chave!: string;

  @ApiProperty({
    required: false,
    example: 'infra',
    description: 'Who proposed it (the offer payload `escopo`); default empty.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  escopo?: string;

  @ApiProperty({ enum: ['aceitar', 'recusar'] })
  @IsIn(['aceitar', 'recusar'])
  decisao!: 'aceitar' | 'recusar';
}

export class AutomacaoResponseDto {
  @ApiProperty({ example: 'handoff' })
  categoria!: string;

  @ApiProperty({ example: 'arquiteto->infra' })
  chave!: string;

  @ApiProperty({ example: true })
  ligada!: boolean;

  @ApiProperty({ enum: ['padrao', 'oferta', 'manual'], example: 'padrao' })
  origem!: 'padrao' | 'oferta' | 'manual';

  @ApiProperty({ type: String, nullable: true, example: null })
  userId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'When the key was last changed; null while it is the default.',
  })
  alteradaEm!: Date | null;
}
