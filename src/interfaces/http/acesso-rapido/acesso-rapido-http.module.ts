import { DynamicModule, Module } from '@nestjs/common';
import { AuthUseCasesModule } from '../../../application/use-cases/auth/auth-use-cases.module';
import { AcessoRapidoUseCase } from '../../../application/use-cases/acesso-rapido/acesso-rapido.use-case';
import { acessoRapidoLigado } from '../../../infrastructure/security/ambiente';
import { AcessoRapidoController } from './acesso-rapido.controller';

@Module({})
export class AcessoRapidoHttpModule {
  /** Módulo vazio fora de `local`: a rota não existe (404), nem no OpenAPI. */
  static registrar(ligado: boolean = acessoRapidoLigado()): DynamicModule {
    return ligado
      ? {
          module: AcessoRapidoHttpModule,
          imports: [AuthUseCasesModule],
          controllers: [AcessoRapidoController],
          providers: [AcessoRapidoUseCase],
        }
      : { module: AcessoRapidoHttpModule };
  }
}
