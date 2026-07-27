import { ApiProperty } from '@nestjs/swagger';
import type {
  Actor,
  ActorKind,
} from '../../../../domain/sessions/session-event.entity';
import type { MesmasChaves, Wire } from './wire';

/**
 * Os DTOs de resposta que atravessam domínios (Fase 7b, item 6).
 *
 * Ficam aqui, e não duplicados por controller, porque `{ ok: true }` sai de
 * sete rotas diferentes e o `Actor` aparece em evento, ação e handoff. Schema
 * repetido no documento gerado é ruído para quem lê a referência.
 */

/**
 * A resposta de comando que não devolve recurso.
 *
 * Sete rotas respondem exatamente isto. Não é 204 porque o corpo `{ ok: true }`
 * já está no contrato de hoje e a web depende dele — mudar seria quebrar
 * cliente sem ganho.
 */
export class OkResponseDto {
  @ApiProperty({
    example: true,
    description: 'Sempre `true`; falha vira erro HTTP.',
  })
  ok!: true;
}

/** Quem originou um evento ou uma ação: pessoa, agente ou o próprio sistema. */
export class ActorResponseDto implements Wire<Actor> {
  @ApiProperty({
    enum: ['user', 'agent', 'system'],
    example: 'agent',
    description: 'Natureza de quem agiu.',
  })
  kind!: ActorKind;

  @ApiProperty({
    example: 'dev-api',
    description:
      'Id do usuário quando `kind=user`; o slug do agente quando `kind=agent`.',
  })
  id!: string;
}
export const _chavesActor: MesmasChaves<ActorResponseDto, Actor> = true;
