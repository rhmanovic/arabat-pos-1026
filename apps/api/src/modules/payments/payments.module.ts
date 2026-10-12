import { Module } from '@nestjs/common';
import { PaymentsController, PosPaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  controllers: [PaymentsController, PosPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
