import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { CreateWarehouseDto, WarehouseDto } from './warehouse.dto.js';
import { WarehousesService } from './warehouses.service.js';

@ApiTags('warehouses')
@Controller('warehouses')
@TenantEndpoint(...TENANT_ROLES)
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions('warehouses:read')
  @ApiOperation({ summary: '分页列出当前商家仓库（含默认仓库和历史停用仓库）' })
  @ApiPageResponse(WarehouseDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: PaginationQueryDto) {
    return this.warehouses.list(context, query);
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  @RequirePermissions('warehouses:write')
  @ApiOperation({
    summary: '创建仓库',
    description: '编码在当前商家内唯一；不提供删除、调拨或库存修改。',
  })
  @ApiDataResponse(WarehouseDto, 201)
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateWarehouseDto,
    @Req() request: ApiRequest,
  ) {
    return this.warehouses.create(context, dto, request.requestId);
  }
}
