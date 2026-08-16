import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { DecidirImagemDoProjetoUseCase } from './decidir-imagem-do-projeto.use-case';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from './obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from './registrar-transicao-de-container.use-case';

const USE_CASES = [
  DecidirImagemDoProjetoUseCase,
  ObterContainerDoProjetoUseCase,
  ObterCicloDeVidaDoContainerUseCase,
  RegistrarTransicaoDeContainerUseCase,
];

/**
 * O container do projeto (FASE 25, ADR 0065; ciclo de vida, ADR 0081).
 *
 * Módulo próprio e não uma pasta em `architecture/`: a decisão é do Arquiteto,
 * mas o CONSUMIDOR dela é a fronteira de execução — a aba Code hoje, o
 * provisionador amanhã. Pendurá-lo em arquitetura faria o portão depender do
 * módulo que emite o artefato, quando a relação é o contrário.
 *
 * `SessionsUseCasesModule` entra por `AppendSessionEventUseCase` e pelo
 * `SessionEventRepository` — o event log É o registro do artefato de imagem.
 *
 * `Obter/RegistrarTransicaoDeContainer` (ADR 0081) são o ESTADO — tabela
 * `project_containers`, mutável, nada a ver com o event log. Nenhum dos
 * dois chama Docker: só gravam/leem o que um orquestrador real (ainda
 * inexistente) consumiria.
 */
@Module({
  imports: [SessionsUseCasesModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ContainersUseCasesModule {}
