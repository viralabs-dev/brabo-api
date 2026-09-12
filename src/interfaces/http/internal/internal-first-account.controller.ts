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
import { CriarPrimeiraContaUseCase } from '../../../application/use-cases/auth/criar-primeira-conta.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { FirstAccountInternalDto } from './dto/first-account-internal.dto';
import { FirstAccountInternalResponseDto } from './dto/first-account-internal.response.dto';

/**
 * A primeira conta da instalação (RN-546, ADR 0155).
 *
 * ## Por que INTERNA, e nunca pública
 *
 * Uma rota pública de "criar o primeiro owner" é uma corrida entre quem
 * instalou e quem escaneou a porta. Quem perde a corrida perde a instalação:
 * `owner` do primeiro workspace não é um papel que se recupere por HTTP.
 *
 * O `BRABO_SERVICE_TOKEN` fecha a corrida no lugar certo — ele é gerado pelo
 * próprio `install.sh` e escrito no `.env` com modo 600, então apresentá-lo
 * prova controle da MÁQUINA, que é a credencial que este passo realmente
 * quer. O mecanismo é o mesmo das outras rotas `internal/*` (cabeçalho
 * próprio, comparado em tempo constante) e a classificação `engine-service`
 * descreve o MECANISMO, não o remetente — a razão inteira está em
 * `service-token.ts` e vale igual para o instalador.
 *
 * ## A superfície nova, declarada
 *
 * Isto é um segundo caminho de criação de usuário, e ele funciona em
 * PRODUÇÃO — o registro normal é o primeiro. Ele é estreito por construção
 * (primeira conta, rota interna, service token) e some assim que a instalação
 * tem gente: o caso de uso recusa com 409 havendo QUALQUER usuário, condição
 * sobre a instalação inteira e não sobre o e-mail pedido. Está declarado aqui,
 * nas Consequences do ADR 0155 e em `docs/security-surface.md`, em vez de
 * ficar para ser descoberto.
 *
 * ## Sem `@Get` e sem `@Delete`
 *
 * "Existe algum usuário?" é uma pergunta sobre a instalação que ninguém
 * precisa fazer de fora: quem chama o `POST` recebe 201 ou 409, e o 409 já é
 * a resposta. Uma rota de leitura publicaria o mesmo fato com uma superfície
 * a mais, e a resposta dela seria o sinal exato que um scanner quer.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal/first-account')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalFirstAccountController {
  constructor(private readonly criarPrimeiraConta: CriarPrimeiraContaUseCase) {}

  @Post()
  @ApiOperation({
    summary: 'Creates the FIRST account of an installation, already verified',
    description:
      'For the one-line installer, which runs where no mail transport is ' +
      'configured: the generated `.env` carries no mail variable, ' +
      '`MAIL_TRANSPORT` falls to `log`, and normal registration waits on an ' +
      'e-mail that never arrives. The account is born verified because ' +
      'whoever runs the installer already proved something STRONGER than ' +
      'controlling a mailbox — they control the machine, the `.env` and the ' +
      'Docker daemon. Normal registration is untouched. Refuses with 409 ' +
      'when the installation has ANY user: the condition is about the ' +
      'installation, not about this e-mail, so a migration restore silences ' +
      'the step by the same test. The password is never generated here and ' +
      'never stored anywhere but as an argon2id hash; the personal workspace ' +
      '(RN-410) is born in the same transaction.',
  })
  @ApiCreatedResponse({ type: FirstAccountInternalResponseDto })
  @ApiBadRequestResponse({
    description:
      'Malformed e-mail, or a password the DOMAIN policy refuses — the same ' +
      'code registration calls, never a second rule.',
  })
  @ApiConflictResponse({
    description: 'The installation already has a user. Nothing was created.',
  })
  criar(
    @Body() corpo: FirstAccountInternalDto,
  ): Promise<FirstAccountInternalResponseDto> {
    return this.criarPrimeiraConta.execute({
      email: corpo.email,
      senha: corpo.senha,
      nome: corpo.nome ?? null,
    });
  }
}
