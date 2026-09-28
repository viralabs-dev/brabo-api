import { Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ListMachineDeviceKeysUseCase } from '../../../application/use-cases/auth/list-machine-device-keys.use-case';
import { RevokeMachineDeviceKeyUseCase } from '../../../application/use-cases/auth/revoke-machine-device-key.use-case';
import { RunnerDeviceKeyListResponseDto } from './dto/runner-device-key-list.response.dto';

/**
 * As chaves de MÁQUINA do próprio usuário, por CONTA (RN-611, AT-118).
 *
 * ## Por que uma rota sem `:projectId`
 *
 * A chave de máquina (`runner_device_keys.project_id` nulo, ADR 0154) nasce
 * na instalação de uma linha ANTES de qualquer projeto (RN-547/RN-552), e as
 * três rotas de `RunnerDeviceKeysController` são todas por projeto: numa
 * instalação sem projeto, tela nenhuma a alcançava. Estas duas fecham isso
 * sem abrir nada além: listam e revogam SÓ as de máquina, e SÓ as do
 * chamador.
 *
 * ## Sem `@RequireRole`, e isso não é afrouxar
 *
 * Mesmo padrão de `users/me/credentials` e `users/me/preferences`: o escopo é
 * o PRÓPRIO usuário, e não há projeto nem workspace contra o que resolver um
 * papel. O `userId` vem do JWT de sessão (`@CurrentUser()`) e vai para o
 * WHERE; não há parâmetro que peça a chave de outra pessoa. A visão de
 * `maintainer` (listar/revogar de outro usuário) continua FORA por decisão
 * da RN-519 — esta rota não a reabre por outra porta.
 *
 * ## O que revogar derruba
 *
 * O mesmo que a rota por projeto sempre derrubou para uma chave de máquina:
 * `RevokeMachineDeviceKeyUseCase` delega a `RevokeRunnerDeviceKeyUseCase`,
 * que desconecta o dono em cada projeto em modo `runner` que ele alcança. O
 * alvo continua `{projeto, usuário}` e nunca `{chave}` (RN-520).
 */
@ApiTags('users')
@ApiBearerAuth(BEARER)
@Controller('users/me/machine-device-keys')
export class MachineDeviceKeysController {
  constructor(
    private readonly list: ListMachineDeviceKeysUseCase,
    private readonly revoke: RevokeMachineDeviceKeyUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Lists the authenticated user's own MACHINE device keys",
    description:
      'Account-level, with no project in the path (RN-611): the one-line ' +
      'install creates a machine key before any project exists, and every ' +
      'other listing is per project. Returns ONLY machine keys ' +
      '(`especie: "maquina"`, `projectId: null`) and ONLY the caller’s — ' +
      'project keys stay in their project’s listing, and no one sees ' +
      'another user’s keys (RN-519). Revoked keys are INCLUDED: registering ' +
      'a new machine key revokes the previous one (RN-552), and this list is ' +
      'where that shows. `lastUsedAt` is a recorded use, never a live ' +
      'connection; null means the key was never used.',
  })
  @ApiOkResponse({ type: [RunnerDeviceKeyListResponseDto] })
  listMachineDeviceKeys(@CurrentUser() user: User) {
    return this.list.execute(user.id);
  }

  @Delete(':deviceKeyId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revokes one of the authenticated user’s own MACHINE device keys',
    description:
      'Idempotent — revoking again is not an error. Same revocation as ' +
      '`DELETE /projects/{projectId}/runner-device-keys/{deviceKeyId}`: it ' +
      'also drops the caller’s local agent in EVERY project in runner mode ' +
      'they reach (RN-520/RN-543). The target is `{project, user}`, never ' +
      '`{key}`: another runner of the same user in those projects falls ' +
      'too, and reconnects if its credential is still valid. With no ' +
      'project yet, it only records the revocation. A PROJECT key, a key ' +
      'that does not exist and another user’s key all answer the same 404.',
  })
  @ApiNoContentResponse({ description: 'Key revoked. No body.' })
  @ApiNotFoundResponse({
    description:
      'No machine key with this id belongs to the caller (it does not ' +
      'exist, is a project key, or is someone else’s — one answer for all).',
  })
  async revokeMachineDeviceKey(
    @Param('deviceKeyId') deviceKeyId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.revoke.execute(deviceKeyId, user.id);
  }
}
