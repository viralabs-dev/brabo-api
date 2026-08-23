import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Handoff manual a agente à escolha (ADR 0109/RN-440). `toAgent` tem de
 * estar no catálogo `addressableAgents()` — lead de área ou agente
 * conversacional solo (ex.: `staff`, `ux-designer`) — nunca um subagente;
 * a validação mora em `RequestManualHandoffUseCase`, não nesta camada.
 */
export class RequestManualHandoffDto {
  @ApiProperty({
    example: 'staff',
    description:
      'Slug of the target agent. Must be a lead or an area-less agent — ' +
      'never a subagent.',
  })
  @IsString()
  @MinLength(1)
  toAgent!: string;
}
