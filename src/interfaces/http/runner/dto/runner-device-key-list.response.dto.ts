import { ApiProperty } from '@nestjs/swagger';
import type {
  ChaveDeDispositivoResumo,
  EspecieDeChaveDeDispositivo,
} from '../../../../application/ports/runner-device-key-repository.port';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/**
 * O formato de LISTA da chave de dispositivo (RN-519) — irmão de
 * `PersonalAccessTokenResponseDto`, e por isso com as duas travas de tipo
 * (`Wire`/`MesmasChaves`). Desde o ADR 0203 a lista é a ÚNICA resposta
 * pública sobre chave de dispositivo — o registro pelo navegador, que tinha
 * resposta própria e mais enxuta, saiu junto com o fluxo do ADR 0118.
 *
 * Nunca inclui a JWK pública. Ela não é segredo, mas também não serve pra
 * nada nesta tela — o que a lista existe pra permitir é revogar, e pra isso
 * basta o `id`, o nome e as três datas que dizem se a chave está viva, se
 * alguém já a usou e quando.
 *
 * Desde a RN-543 a lista devolve DUAS espécies de chave, e DIZ qual é qual
 * (`especie`) — é a consequência que o ADR 0154 declara: uma chave de MÁQUINA
 * não é "a chave do projeto X", e ela aparece na listagem de todo projeto que
 * atende. Sem a marca, a mesma linha apareceria em N projetos parecendo N
 * chaves diferentes; sem entrar na lista, ela seria invisível em todas, que é
 * o defeito que a RN-519 fechou renascido na espécie nova.
 */
export class RunnerDeviceKeyListResponseDto implements Wire<ChaveDeDispositivoResumo> {
  @ApiProperty({ example: '01JC4Z0000CHAVE000000000001' })
  id!: string;

  @ApiProperty({ example: 'laptop' })
  name!: string;

  @ApiProperty({
    example: '01JC4Z0000PROJETO000000001',
    nullable: true,
    description:
      'Null = MACHINE key (ADR 0154): valid for any project of its owner, ' +
      'not only this one. See `especie`.',
  })
  projectId!: string | null;

  @ApiProperty({
    enum: ['projeto', 'maquina'],
    example: 'projeto',
    description:
      '`projeto` = bound to the project of this route (ADR 0118). `maquina` = ' +
      'describes the MACHINE (ADR 0154) and appears in the listing of every ' +
      'project it serves — revoking it drops the local agent in all of them.',
  })
  especie!: EspecieDeChaveDeDispositivo;

  @ApiProperty({ example: '2026-08-27T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Null = active. A revoked key keeps appearing in the list.',
  })
  revokedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Null = never used — the sign of an orphan key (tab closed in the ' +
      'middle of the runner automatic setup flow).',
  })
  lastUsedAt!: string | null;
}

export const _chavesRunnerDeviceKey: MesmasChaves<
  RunnerDeviceKeyListResponseDto,
  ChaveDeDispositivoResumo
> = true;
