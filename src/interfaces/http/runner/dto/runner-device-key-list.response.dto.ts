import { ApiProperty } from '@nestjs/swagger';
import type {
  ChaveDeDispositivoResumo,
  EspecieDeChaveDeDispositivo,
} from '../../../../application/ports/runner-device-key-repository.port';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';

/**
 * O formato de LISTA da chave de dispositivo (RN-519) — irmão de
 * `PersonalAccessTokenResponseDto`, e por isso com as duas travas de tipo
 * (`Wire`/`MesmasChaves`), ao contrário do
 * `RunnerDeviceKeyResponseDto` do registro, que é deliberadamente mais
 * enxuto: ali o navegador acabou de criar a chave e já sabe tudo sobre ela;
 * aqui a lista é a ÚNICA fonte do que existe.
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
      'Nulo = chave de MÁQUINA (ADR 0154): vale para qualquer projeto do ' +
      'dono dela, e não só para este. Ver `especie`.',
  })
  projectId!: string | null;

  @ApiProperty({
    enum: ['projeto', 'maquina'],
    example: 'projeto',
    description:
      '`projeto` = presa ao projeto desta rota (ADR 0118). `maquina` = ' +
      'descreve a MÁQUINA (ADR 0154) e aparece na listagem de todo projeto ' +
      'que ela atende — revogá-la derruba o agente local em todos eles.',
  })
  especie!: EspecieDeChaveDeDispositivo;

  @ApiProperty({ example: '2026-08-27T12:00:00.000Z', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Nulo = ativa. Revogada continua aparecendo na lista.',
  })
  revokedAt!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'Nulo = nunca usada — o sinal de uma chave órfã (aba fechada no ' +
      'meio do fluxo de configuração automática do runner).',
  })
  lastUsedAt!: string | null;
}

export const _chavesRunnerDeviceKey: MesmasChaves<
  RunnerDeviceKeyListResponseDto,
  ChaveDeDispositivoResumo
> = true;
