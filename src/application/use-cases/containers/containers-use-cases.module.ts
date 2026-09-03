import { Module } from '@nestjs/common';
import { SessionsUseCasesModule } from '../sessions/sessions-use-cases.module';
import { ContainerBrokerHttpClientModule } from '../../../infrastructure/http-clients/container-broker-http-client.module';
import { DecidirImagemDoProjetoUseCase } from './decidir-imagem-do-projeto.use-case';
import { ObterContainerDoProjetoUseCase } from './obter-container-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from './obter-ciclo-de-vida-do-container.use-case';
import { ObterEstadoObservadoDoContainerUseCase } from './obter-estado-observado-do-container.use-case';
import { ObterSpecDeContainerUseCase } from './obter-spec-de-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from './registrar-transicao-de-container.use-case';
import { ExecutarComandoNoContainerUseCase } from './executar-comando-no-container.use-case';

const USE_CASES = [
  DecidirImagemDoProjetoUseCase,
  ObterContainerDoProjetoUseCase,
  ObterCicloDeVidaDoContainerUseCase,
  ObterEstadoObservadoDoContainerUseCase,
  ObterSpecDeContainerUseCase,
  RegistrarTransicaoDeContainerUseCase,
  ExecutarComandoNoContainerUseCase,
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
 * dois chama Docker: só gravam/leem o que um orquestrador real consumiria.
 *
 * Desde o ADR 0130 existe um que fala com Docker, e ele é de LEITURA:
 * `ObterEstadoObservadoDoContainer` pergunta ao BROKER — o único processo do
 * produto com acesso ao daemon — qual é o estado observado, para a tela poder
 * mostrá-lo ao lado do registrado sem fundir os dois (RN-468). `Registrar
 * Transicao` continua sem chamar nada: quem age é o broker, e o que o dispara
 * é um `proposed_action` que ainda não existe.
 *
 * `ObterSpecDeContainer` é o que o BROKER lê da api para compor a
 * especificação ele mesmo — a chamada que faz o broker não aceitar spec.
 *
 * `ExecutarComandoNoContainer` (ADR 0134) é a segunda escrita real via
 * broker, depois de `container_start`: proxy síncrono chamado pela rota
 * interna que o ENGINE usa para rodar comando de terminal DENTRO do
 * container real do projeto, quando há um `running` (RN-492).
 */
@Module({
  imports: [SessionsUseCasesModule, ContainerBrokerHttpClientModule],
  providers: USE_CASES,
  exports: USE_CASES,
})
export class ContainersUseCasesModule {}
