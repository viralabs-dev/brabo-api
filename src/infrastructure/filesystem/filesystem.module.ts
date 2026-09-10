import { Module } from '@nestjs/common';
import { PermissionsFileStore } from '../../application/ports/permissions-file-store.port';
import { FsPermissionsFileStore } from './fs-permissions-file-store';
import { ArtifactFileStore } from '../../application/ports/artifact-file-store.port';
import { FsArtifactFileStore } from './fs-artifact-file-store';

@Module({
  providers: [
    { provide: PermissionsFileStore, useClass: FsPermissionsFileStore },
    { provide: ArtifactFileStore, useClass: FsArtifactFileStore },
  ],
  exports: [PermissionsFileStore, ArtifactFileStore],
})
export class FilesystemModule {}
