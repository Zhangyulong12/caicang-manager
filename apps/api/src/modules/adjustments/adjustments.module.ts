import { Module } from '@nestjs/common';
import { AdjustmentsController } from './adjustments.controller.js';
import { AdjustmentsService } from './adjustments.service.js';

@Module({
  controllers: [AdjustmentsController],
  providers: [AdjustmentsService],
  exports: [AdjustmentsService],
})
export class AdjustmentsModule {}
