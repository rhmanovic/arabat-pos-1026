import { Global, Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { FileStorage, LocalDiskStorage } from './file-storage.js';
import { GcsStorage } from './gcs-storage.js';

@Global()
@Module({
  providers: [
    {
      provide: FileStorage,
      inject: [ENV],
      useFactory: (env: Env): FileStorage =>
        env.FILE_STORAGE_DRIVER === 'gcs' ? new GcsStorage(env) : new LocalDiskStorage(env),
    },
  ],
  exports: [FileStorage],
})
export class StorageModule {}
