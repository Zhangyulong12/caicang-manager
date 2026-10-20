import { Module } from '@nestjs/common';
import { WarehousesController } from './warehouses.controller.js';
import { WarehousesService } from './warehouses.service.js';

@Module({ controllers: [WarehousesController], providers: [WarehousesService] })
export class WarehousesModule {}
