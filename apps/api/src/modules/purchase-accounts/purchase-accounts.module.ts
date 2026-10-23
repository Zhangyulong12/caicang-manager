import { Module } from '@nestjs/common';
import { PurchaseAccountsController } from './purchase-accounts.controller.js';
import { PurchaseAccountsService } from './purchase-accounts.service.js';

@Module({ controllers: [PurchaseAccountsController], providers: [PurchaseAccountsService] })
export class PurchaseAccountsModule {}
