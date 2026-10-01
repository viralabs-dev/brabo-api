import { Controller, Get, Delete, Param, HttpCode } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ListRunnerDeviceKeysUseCase } from '../../../application/use-cases/auth/list-runner-device-keys.use-case';
import { RevokeRunnerDeviceKeyUseCase } from '../../../application/use-cases/auth/revoke-runner-device-key.use-case';
import { RunnerDeviceKeyListResponseDto } from './dto/runner-device-key-list.response.dto';

/**
 * Gestão de chaves de dispositivo do runner (Ed25519) — a segunda forma de
 * autenticar `POST /projects/:projectId/runner-ticket`, ao lado do Personal
 * Access Token (`PersonalAccessTokensController`).
 *
 * Autenticado por JWT DE SESSÃO normal: quem chama aqui é a TELA (a seção de
 * chaves das Configurações e o reconhecimento do `RunnerOnboardingPanel`).
 * Papel mínimo `developer`, mesma régua de `PersonalAccessTokensController`.
 *
 * ## O `POST` saiu (ADR 0203, RN-687)
 *
 * Até o ADR 0203 havia uma terceira rota, `POST`, que registrava a chave de
 * PROJETO gerada no navegador pelo fluxo do ADR 0118. Aposentado aquele fluxo,
 * ela ficou sem chamador e saiu junto — quem cria chave hoje é o terminal
 * (`brabo-runner device-key create`, RN-551) e quem a registra é o
 * `install.sh`, pela rota interna de MÁQUINA (RN-552). As chaves de projeto
 * JÁ registradas continuam valendo e aparecem aqui: o `GET` as lista e o
 * `DELETE` as revoga, e o `PatAuthGuard` segue aceitando-as no ticket. Um
 * runner configurado pelo navegador antes do ADR 0203 não quebra.
 *
 * ## As duas rotas, e o que continua fora (RN-519/RN-520, ADR 0147 ponto 6)
 *
 * `@Get()` e `@Delete(':deviceKeyId')`, as duas `developer` e as duas
 * escopadas ao PRÓPRIO usuário. A listagem entrou porque **ninguém
 * revoga o que não consegue ver**: até ela existir, este controller tinha
 * `@Post()` e `@Delete()` e nada mais, e uma chave órfã — aba fechada no meio
 * do fluxo do ADR 0118 — era invisível e permanente, sem tela nenhuma onde
 * revogá-la.
 *
 * O que continua fora, agora por DECISÃO e não por omissão, é a visão de
 * `maintainer` que o PAT tem desde a RN-427 (`@Get('all')` e
 * `@Delete(':tokenId/admin')`, listar/revogar de qualquer usuário do
 * projeto). Aquelas duas nasceram de resposta a incidente — dev desligado
 * com um segredo COMPARTILHADO circulando —, e chave de dispositivo não é
 * esse bicho: a metade privada nunca sai da máquina que a gerou, então não
 * há segredo a conter na mão de outro. O que a `@Delete` daqui ganhou em
 * troca é ALCANCE — ela derruba a conexão viva, não só o ticket seguinte.
 *
 * O `DELETE` continua 204 e idempotente, e continua não podendo falhar por
 * causa do engine: derrubar o runner é efeito colateral, tratado dentro do
 * caso de uso (ver `RevokeRunnerDeviceKeyUseCase`). Desde o ADR 0201
 * (RN-685) o alvo dessa queda é a CHAVE, e não o par `{projeto, usuário}`.
 *
 * ## As duas espécies de chave, e por que estas rotas bastam (RN-543)
 *
 * Desde o ADR 0154 existe a chave de MÁQUINA (`project_id` NULL), e ela cabe
 * nestas rotas sem rota nova: o `GET` a inclui MARCADA (uma de máquina não é
 * "a chave do projeto X"), e o `DELETE` já casava por `{id, usuário}` e nunca
 * por projeto, então revogá-la sempre funcionou daqui. Quem registra chave
 * de máquina é o `install.sh`, pela rota INTERNA
 * (`InternalMachineDeviceKeysController`, RN-552) — nunca por aqui.
 */
@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto não encontrado.' })
@Controller('projects/:projectId/runner-device-keys')
export class RunnerDeviceKeysController {
  constructor(
    private readonly list: ListRunnerDeviceKeysUseCase,
    private readonly revoke: RevokeRunnerDeviceKeyUseCase,
  ) {}

  @Get()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Lista as próprias chaves de dispositivo deste projeto',
    description:
      'Ninguém revoga o que não consegue ver (RN-519). Inclui as já ' +
      'REVOGADAS — sumir com a linha faria a tela afirmar que a chave ' +
      'nunca existiu. Nunca devolve a JWK pública, e a privada a api nunca ' +
      'viu. `lastUsedAt` nulo é o sinal de uma chave ÓRFÃ: registrada e ' +
      'nunca usada por runner nenhum. Desde a RN-543 inclui também as ' +
      'chaves de MÁQUINA do chamador (`especie: "maquina"`, `projectId` ' +
      'nulo), que servem este projeto sem pertencer a ele — sem elas na ' +
      'lista, uma chave de máquina seria invisível em toda tela.',
  })
  @ApiOkResponse({ type: [RunnerDeviceKeyListResponseDto] })
  listDeviceKeys(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.list.execute(user.id, projectId);
  }

  @Delete(':deviceKeyId')
  @RequireRole('developer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoga uma chave de dispositivo própria',
    description:
      'Idempotente — revogar de novo não é erro. Desde a RN-520 também ' +
      'DERRUBA a conexão viva: antes, revogar só impedia ticket NOVO, e um ' +
      'runner já conectado seguia executando comando aprovado. Desde a ' +
      'RN-685 (ADR 0201) o alvo é a CHAVE: caem só as conexões abertas com ' +
      'ela — em todo projeto, se for de máquina —, e outro runner do mesmo ' +
      'usuário, conectado com PAT ou com outra chave, fica de pé. Os ' +
      'tickets dela ainda não usados são anulados. Engine fora do ar ou ' +
      'nenhum runner conectado NÃO fazem a revogação falhar.',
  })
  @ApiNoContentResponse({ description: 'Chave revogada. Sem corpo.' })
  async revokeDeviceKey(
    @Param('projectId') _projectId: string,
    @Param('deviceKeyId') deviceKeyId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.revoke.execute(deviceKeyId, user.id);
  }
}
