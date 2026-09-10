import { Module } from '@nestjs/common';
import { FilesystemModule } from '../../infrastructure/filesystem/filesystem.module';
import { ArtifactProjector } from './artifact-projector';

/**
 * O `ArtifactProjector` roda como serviço de fundo (poller sobre
 * `outbox_events`), independente de rota HTTP — mesma forma do
 * `GraphProjectionModule`.
 *
 * `OutboxRepository`, `SessionEventRepository` e `ProjectRepository` vêm do
 * `DrizzleModule`, que é `@Global()`; só a porta de filesystem precisa ser
 * importada aqui.
 */
@Module({
  imports: [FilesystemModule],
  providers: [ArtifactProjector],
  exports: [ArtifactProjector],
})
export class ArtifactProjectionModule {}
