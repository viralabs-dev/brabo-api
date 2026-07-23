import { Module } from '@nestjs/common';
import { ApiToEngineClient } from '../../application/ports/api-to-engine-client.port';
import { HttpApiToEngineClient } from './api-to-engine-client';

@Module({
  providers: [{ provide: ApiToEngineClient, useClass: HttpApiToEngineClient }],
  exports: [ApiToEngineClient],
})
export class EngineHttpClientsModule {}
