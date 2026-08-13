import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { DecidirImagemDoProjetoUseCase } from './decidir-imagem-do-projeto.use-case';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';

const USE_CASES = [
  DecidirImagemDoProjetoUseCase,
  ObterContainerDoProjetoUseCase,
];

/**
 * O container do projeto (FASE 25, ADR 0065).
 *
 * Módulo próprio e não uma pasta em `architecture/`: a decisão é do Arquiteto,
 * mas o CONSUMIDOR dela é a fronteira de execução — a aba Code hoje, o
 * provisionador amanhã. Pendurá-lo em arquitetura faria o portão depender do
 * módulo que emite o artefato, quando a relação é o contrário.
 *
 * `SessionsUseCasesModule` entra por `AppendSessionEventUseCase` e pelo
 * `SessionEventRepository` — o event log É o registro do artefato.
 */
@Module({
  imports: [SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ContainersUseCasesModule {}
