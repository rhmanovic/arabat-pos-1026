import { Global, Module } from '@nestjs/common';
import { FileStorage, LocalDiskStorage } from './file-storage.js';

@Global()
@Module({
  providers: [{ provide: FileStorage, useClass: LocalDiskStorage }],
  exports: [FileStorage],
})
export class StorageModule {}
