import { Global, Module } from '@nestjs/common';
import { ApiToEngineClient } from '../../application/ports/api-to-engine-client.port';
import { SessionChannelNotifier } from '../../application/ports/session-channel-notifier.port';
import { HttpApiToEngineClient } from './api-to-engine-client';
import { HttpSessionChannelNotifier } from './session-channel-notifier';

// Global só pelo notifier (AT-157): é dependência opcional de casos de uso
// que moram em vários módulos, e o `ApiToEngineClient` continua sendo
// importado explicitamente por quem o usa.
@Global()
@Module({
  providers: [
    { provide: ApiToEngineClient, useClass: HttpApiToEngineClient },
    { provide: SessionChannelNotifier, useClass: HttpSessionChannelNotifier },
  ],
  exports: [ApiToEngineClient, SessionChannelNotifier],
})
export class EngineHttpClientsModule {}
