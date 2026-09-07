import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
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
import { RegisterRunnerDeviceKeyUseCase } from '../../../application/use-cases/auth/register-runner-device-key.use-case';
import { ListRunnerDeviceKeysUseCase } from '../../../application/use-cases/auth/list-runner-device-keys.use-case';
import { RevokeRunnerDeviceKeyUseCase } from '../../../application/use-cases/auth/revoke-runner-device-key.use-case';
import { RegisterRunnerDeviceKeyRequestDto } from './dto/register-runner-device-key.request.dto';
import { RunnerDeviceKeyResponseDto } from './dto/runner-device-key.response.dto';
import { RunnerDeviceKeyListResponseDto } from './dto/runner-device-key-list.response.dto';

/**
 * Gestão de chaves de dispositivo do runner (Ed25519, gerada no navegador) —
 * a segunda forma de autenticar `POST /projects/:projectId/runner-ticket`,
 * ao lado do Personal Access Token (`PersonalAccessTokensController`).
 *
 * Autenticado por JWT DE SESSÃO normal — diferente de `runner-ticket`, quem
 * chama aqui É um browser: o usuário já logado registrando a chave do
 * dispositivo que está prestes a baixar e rodar o binário do runner
 * (`RunnerReleasesController`). Papel mínimo `developer`, mesma régua de
 * `PersonalAccessTokensController` — registrar uma credencial não pode ser
 * mais fácil que usar a capacidade que ela concede.
 *
 * ## Três rotas, e o que continua fora (RN-519/RN-520, ADR 0147 ponto 6)
 *
 * `@Post()`, `@Get()` e `@Delete(':deviceKeyId')`, as três `developer` e as
 * três escopadas ao PRÓPRIO usuário. A listagem entrou porque **ninguém
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
 * esse bicho: a metade privada nunca sai do navegador que a gerou, então não
 * há segredo a conter na mão de outro. O que a `@Delete` daqui ganhou em
 * troca é ALCANCE — ela derruba a conexão viva, não só o ticket seguinte.
 *
 * O `DELETE` continua 204 e idempotente, e continua não podendo falhar por
 * causa do engine: derrubar o runner é efeito colateral, tratado dentro do
 * caso de uso (ver `RevokeRunnerDeviceKeyUseCase`).
 */
@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto não encontrado.' })
@Controller('projects/:projectId/runner-device-keys')
export class RunnerDeviceKeysController {
  constructor(
    private readonly register: RegisterRunnerDeviceKeyUseCase,
    private readonly list: ListRunnerDeviceKeysUseCase,
    private readonly revoke: RevokeRunnerDeviceKeyUseCase,
  ) {}

  @Post()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Registra a chave pública de um dispositivo do runner local',
    description:
      'A chave PRIVADA nunca sai do navegador — só a JWK pública (Ed25519, ' +
      'RFC 8037) chega aqui. Use o `id` desta resposta como `kid` no header ' +
      'do JWT que o runner assina pra pedir ticket em `POST ' +
      '.../runner-ticket`.',
  })
  @ApiCreatedResponse({ type: RunnerDeviceKeyResponseDto })
  async registerDeviceKey(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: RegisterRunnerDeviceKeyRequestDto,
  ): Promise<RunnerDeviceKeyResponseDto> {
    const registrada = await this.register.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      publicKeyJwk: dto.publicKeyJwk,
    });
    return {
      id: registrada.id,
      name: registrada.name,
      createdAt: registrada.createdAt.toISOString(),
    };
  }

  @Get()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Lista as próprias chaves de dispositivo deste projeto',
    description:
      'Ninguém revoga o que não consegue ver (RN-519). Inclui as já ' +
      'REVOGADAS — sumir com a linha faria a tela afirmar que a chave ' +
      'nunca existiu. Nunca devolve a JWK pública, e a privada a api nunca ' +
      'viu. `lastUsedAt` nulo é o sinal de uma chave ÓRFÃ: registrada e ' +
      'nunca usada por runner nenhum.',
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
      'DERRUBA o runner conectado deste usuário no projeto da chave: antes, ' +
      'revogar só impedia ticket NOVO, e um runner já conectado seguia ' +
      'executando comando aprovado. O alvo é `{projeto, usuário}` e não ' +
      '`{chave}` — um runner do MESMO usuário conectado com PAT ou com ' +
      'outra chave também cai, e reconecta sozinho se a credencial dele ' +
      'ainda valer. Engine fora do ar ou nenhum runner conectado NÃO fazem ' +
      'a revogação falhar.',
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
