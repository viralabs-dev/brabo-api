import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * O "Hello World!" do scaffold do NestJS.
   *
   * `@ApiExcludeEndpoint()` em vez de um summary: está atrás do guard e não
   * vaza nada, mas não serve a nada — é candidato a remoção registrado em
   * `docs/security-surface.md`. Documentá-lo na referência lhe daria um status
   * de contrato que ele não tem, e alguém acabaria dependendo dele.
   *
   * A exclusão é EXPLÍCITA e o teste de tabela a conhece: não é um jeito de
   * escapar da exigência de metadados, é uma decisão registrada.
   */
  @Get()
  @ApiExcludeEndpoint()
  getHello(): string {
    return this.appService.getHello();
  }
}
