import { Module } from '@nestjs/common';
import { ContainerBrokerPort } from '../../application/ports/container-broker.port';
import { HttpContainerBrokerClient } from './container-broker.client';

/**
 * Módulo PRÓPRIO, e não uma linha a mais em `EngineHttpClientsModule`
 * (ADR 0130): aquele nomeia o engine, e o broker é outro serviço, com outra
 * imagem, outra rede e outro modo de faltar. Pendurá-lo lá faria "quem depende
 * do engine" incluir quem não depende.
 */
@Module({
  providers: [
    { provide: ContainerBrokerPort, useClass: HttpContainerBrokerClient },
  ],
  exports: [ContainerBrokerPort],
})
export class ContainerBrokerHttpClientModule {}
