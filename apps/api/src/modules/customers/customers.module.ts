import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module.js';
import { CustomersController, PosCustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({
  imports: [SalesModule],
  controllers: [CustomersController, PosCustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
