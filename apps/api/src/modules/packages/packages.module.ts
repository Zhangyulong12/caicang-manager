import { Module } from '@nestjs/common';
import { PackagesController, PurchasePackagesController } from './packages.controller.js';
import { PackagesService } from './packages.service.js';
@Module({
  controllers: [PurchasePackagesController, PackagesController],
  providers: [PackagesService],
})
export class PackagesModule {}
