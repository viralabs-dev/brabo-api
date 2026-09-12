import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { RegistrarChaveDeMaquinaUseCase } from '../../../application/use-cases/auth/registrar-chave-de-maquina.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { MachineDeviceKeyInternalDto } from './dto/machine-device-key-internal.dto';
import { MachineDeviceKeyInternalResponseDto } from './dto/machine-device-key-internal.response.dto';

/**
 * A chave de dispositivo de MÁQUINA do instalador (RN-552, ADR 0155 ponto 4).
 *
 * Segundo passo do mesmo instalador cujo primeiro é
 * `InternalFirstAccountController`: conta criada, o `install.sh` gera um par
 * Ed25519 NA MÁQUINA, manda a metade pública aqui e grava a privada com o `id`
 * desta resposta dentro, no `kid` (RN-475). Depois instala o serviço.
 *
 * ## A credencial é a mesma da primeira conta, e a escolha é declarada
 *
 * `BRABO_SERVICE_TOKEN`, pelo `EngineServiceGuard`, em tempo constante. Duas
 * candidatas eram reais e a segunda foi recusada por contrariar o próprio
 * ADR 0155:
 *
 * - **Service token.** É o mesmo instalador, no mesmo minuto, e o token prova
 *   controle da MÁQUINA — que é exatamente o que este passo quer provar. A
 *   classificação `engine-service` descreve o MECANISMO e não o remetente,
 *   como já vale para a rota de primeira conta.
 * - **Credencial do usuário recém-criado.** Obrigaria o instalador a fazer
 *   login com a senha que ele acabou de ler no TTY — e essa senha é
 *   *"usada e descartada"* por decisão escrita (RN-546), enquanto o ADR 0155
 *   ponto 5 já declara que *"o instalador não faz login por ninguém"* e por
 *   isso a primeira conta não devolve token de sessão. Exigi-la aqui obrigaria
 *   a criar, na máquina, uma sessão viva que aquele ADR recusou criar.
 *
 * **O que essa escolha custa, dito em vez de deixado para ser descoberto:**
 * um `BRABO_SERVICE_TOKEN` vazado passa a poder FABRICAR uma credencial de
 * acesso duradoura de um usuário, e não só falar com as rotas internas. Está
 * declarado em `docs/security-surface.md`, ao lado da declaração irmã da
 * primeira conta.
 *
 * ## O que impede a rota de virar fábrica de chaves
 *
 * Três coisas, e as três estão no código, não no texto:
 *
 * 1. **Não há `userId` no corpo.** O dono é o usuário ÚNICO da instalação,
 *    resolvido pelo caso de uso; zero ou mais de um responde 409 e nada é
 *    escrito. É o análogo da condição da RN-546 — sobre a INSTALAÇÃO, nunca
 *    sobre o argumento pedido —, e é o que impede que quem tenha o token
 *    escolha a vítima.
 * 2. **Registrar SUBSTITUI.** As chaves de máquina ativas do dono são
 *    revogadas na mesma transação: uma máquina reinstalada é caso legítimo e
 *    passa; mil chaves de máquina viram impossíveis, sem um número que
 *    envelheça.
 * 3. **A privada é recusada.** Uma JWK com `d` responde 400 dizendo o que ela
 *    é, pela MESMA régua de domínio do registro pelo navegador.
 *
 * ## Sem `@Get` e sem `@Delete`
 *
 * Mesmo motivo da rota de primeira conta. Listar chaves por aqui publicaria,
 * para quem só tem o token da máquina, o inventário de credenciais de uma
 * pessoa; revogar já existe onde tem dono humano
 * (`DELETE /projects/:projectId/runner-device-keys/:deviceKeyId`, que casa por
 * `{id, usuário}` e nunca por projeto). O que essa assimetria custa está
 * declarado na RN-552: numa instalação ainda sem projeto, não há tela que
 * alcance uma chave de máquina — e é por isso que o registro SUBSTITUI em vez
 * de deixar órfãs para trás.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal/machine-device-keys')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalMachineDeviceKeysController {
  constructor(private readonly registrar: RegistrarChaveDeMaquinaUseCase) {}

  @Post()
  @ApiOperation({
    summary: 'Registers the MACHINE device key of a fresh installation',
    description:
      'For the one-line installer, right after it creates the first ' +
      'account: the local agent needs a credential, and the only one that ' +
      'existed was bound to a PROJECT — in an installation that has none ' +
      'yet. The pair is generated ON THE MACHINE and only the public half ' +
      'arrives here; write the returned `id` into the private JWK as `kid` ' +
      '(RN-475), which is the only link between the file on disk and the ' +
      'public half on the server. There is no `userId` in the body ON ' +
      "PURPOSE: the owner is the installation's SOLE user, resolved by the " +
      'api, so holding the service token never means choosing whose ' +
      "credential to mint. Registering REPLACES: the owner's active machine " +
      'keys are revoked in the same transaction, so a reinstalled machine ' +
      'works and a thousand machine keys cannot exist. Project keys ' +
      '(ADR 0118) are never touched.',
  })
  @ApiCreatedResponse({ type: MachineDeviceKeyInternalResponseDto })
  @ApiBadRequestResponse({
    description:
      'The JWK is not a PUBLIC Ed25519 key — malformed JSON, wrong ' +
      '`kty`/`crv`, missing `x`, or carrying `d` (that is the private half, ' +
      'and it is refused by name rather than stored).',
  })
  @ApiConflictResponse({
    description:
      'The installation has no user, or more than one. Nothing was written. ' +
      'This route belongs to the moment of installation and goes quiet for ' +
      'good once the installation has a team.',
  })
  async registrarChave(
    @Body() corpo: MachineDeviceKeyInternalDto,
  ): Promise<MachineDeviceKeyInternalResponseDto> {
    const chave = await this.registrar.execute({
      name: corpo.name,
      publicKeyJwk: corpo.publicKeyJwk,
    });
    return {
      id: chave.id,
      userId: chave.userId,
      name: chave.name,
      createdAt: chave.createdAt.toISOString(),
      replacedKeyIds: chave.substituidas,
    };
  }
}
