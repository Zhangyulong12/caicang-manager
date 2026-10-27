import { Module } from '@nestjs/common';
import { PurchaseReturnsController } from './purchase-returns.controller.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
@Module({ controllers: [PurchaseReturnsController], providers: [PurchaseReturnsService] })
export class PurchaseReturnsModule {}
