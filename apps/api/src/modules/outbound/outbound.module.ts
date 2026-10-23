import { Module } from '@nestjs/common';
import { OutboundOrdersController } from './outbound.controller.js';
import { OutboundOrdersService } from './outbound.service.js';

@Module({
  controllers: [OutboundOrdersController],
  providers: [OutboundOrdersService],
})
export class OutboundOrdersModule {}
