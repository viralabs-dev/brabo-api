import { Module } from '@nestjs/common';
import { PermissionsFileStore } from '../../application/ports/permissions-file-store.port';
import { FsPermissionsFileStore } from './fs-permissions-file-store';

@Module({
  providers: [
    { provide: PermissionsFileStore, useClass: FsPermissionsFileStore },
  ],
  exports: [PermissionsFileStore],
})
export class FilesystemModule {}
