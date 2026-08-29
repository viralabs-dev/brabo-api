import {
  Controller,
  Post,
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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { RegisterRunnerDeviceKeyUseCase } from '../../../application/use-cases/auth/register-runner-device-key.use-case';
import { RevokeRunnerDeviceKeyUseCase } from '../../../application/use-cases/auth/revoke-runner-device-key.use-case';
import { RegisterRunnerDeviceKeyRequestDto } from './dto/register-runner-device-key.request.dto';
import { RunnerDeviceKeyResponseDto } from './dto/runner-device-key.response.dto';

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
 * Sem a visão de `maintainer` (listar/revogar de qualquer usuário) que o PAT
 * tem — fora de escopo por ora, mesmo corte declarado no ADR desta rodada.
 */
@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto não encontrado.' })
@Controller('projects/:projectId/runner-device-keys')
export class RunnerDeviceKeysController {
  constructor(
    private readonly register: RegisterRunnerDeviceKeyUseCase,
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

  @Delete(':deviceKeyId')
  @RequireRole('developer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoga uma chave de dispositivo própria',
    description: 'Idempotente — revogar de novo não é erro.',
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
