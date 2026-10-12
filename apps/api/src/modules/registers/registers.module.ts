import { Module } from '@nestjs/common';
import { PosShiftsController, RegistersController } from './registers.controller.js';
import { ShiftsService } from './shifts.service.js';

@Module({
  controllers: [RegistersController, PosShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class RegistersModule {}
