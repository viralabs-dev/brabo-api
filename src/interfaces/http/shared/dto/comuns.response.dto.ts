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
    description: 'Always `true`; failure becomes an HTTP error.',
  })
  ok!: true;
}

/** Who originated an event or an action: a person, an agent, or the system itself. */
export class ActorResponseDto implements Wire<Actor> {
  @ApiProperty({
    enum: ['user', 'agent', 'system'],
    example: 'agent',
    description: 'Nature of who acted.',
  })
  kind!: ActorKind;

  @ApiProperty({
    example: 'dev-api',
    description:
      "The user's id when `kind=user`; the agent's slug when `kind=agent`.",
  })
  id!: string;
}
export const _chavesActor: MesmasChaves<ActorResponseDto, Actor> = true;
