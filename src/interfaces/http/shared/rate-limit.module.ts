import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Registra o rate limit como guard global (Fase 5, item 7).
 *
 * A ORDEM importa e é dada pela posição do import no AppModule: os `APP_GUARD`
 * rodam na ordem em que os módulos são importados, e este precisa vir DEPOIS do
 * `AuthHttpModule`. O guard lê `request.user` e `request.clientId`, que só
 * existem depois que o `JwtAuthGuard` populou os dois — invertido, todo request
 * cairia no balde de IP e o `engine-service` seria estrangulado junto.
 *
 * Módulo próprio, e não um provider solto no AppModule, para que essa dependência
 * de ordem fique visível na lista de imports em vez de escondida.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
