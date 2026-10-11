import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller.js';

@Module({ controllers: [BranchesController] })
export class BranchesModule {}
