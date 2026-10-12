import { Module } from '@nestjs/common';
import { RegistersModule } from '../registers/registers.module.js';
import { CashController } from './cash.controller.js';
import { CashService } from './cash.service.js';

@Module({
  imports: [RegistersModule],
  controllers: [CashController],
  providers: [CashService],
})
export class CashModule {}
