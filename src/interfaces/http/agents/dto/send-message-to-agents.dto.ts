import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';
import { SendAgentMessageDto } from './send-agent-message.dto';

/** AT-717 (ADR 0247): a mesma mensagem para 1 a 7 agentes conversacionais. */
export class SendMessageToAgentsDto extends SendAgentMessageDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 7,
    example: ['po', 'arquiteto'],
    description:
      'Slugs of the conversational agents that read the message (1 to 7). One that cannot take it comes back as `recusada` in `entregas`; the others are not affected (RN-991).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsString({ each: true })
  destinatarios!: string[];
}

export class EntregaAoAgenteResponseDto {
  @ApiProperty({ example: 'po' })
  agente!: string;

  @ApiProperty({
    enum: ['turno', 'enfileirada', 'recusada'],
    description:
      '`turno`: the agent started a turn with it. `enfileirada`: it joined the agent queue (RN-673). `recusada`: the agent did not take it; see `motivo`.',
  })
  entrega!: 'turno' | 'enfileirada' | 'recusada';

  @ApiPropertyOptional({ example: 'Agent is not active in this session.' })
  motivo?: string;
}

export class MensagemAosAgentesResponseDto {
  @ApiProperty({ example: '01JC4Z0000EVENTO000000000001' })
  mensagemId!: string;

  @ApiProperty({ type: [EntregaAoAgenteResponseDto] })
  entregas!: EntregaAoAgenteResponseDto[];
}
