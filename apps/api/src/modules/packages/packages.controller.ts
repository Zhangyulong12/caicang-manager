import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiArrayResponse, ApiDataResponse } from '../../common/api-docs.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { PackagesService } from './packages.service.js';
import {
  CreatePackageDto,
  UpdatePackageDto,
  PackageIdDto,
  PackageLookupQueryDto,
  PackageResultDto,
  PackageLookupResultDto,
} from './package.dto.js';

@ApiTags('packages')
@Controller('purchase-orders')
@TenantEndpoint('OWNER', 'ADMIN', 'BUYER')
export class PurchasePackagesController {
  constructor(private readonly packages: PackagesService) {}
  @Post(':id/packages')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('packages:write')
  @ApiOperation({ summary: '已下单采购绑定包裹，锁主单校验累计预计数量，不改变库存' })
  @ApiDataResponse(PackageResultDto, 201)
  create(
    @CurrentTenant() context: TenantContext,
    @Param() params: PackageIdDto,
    @Body() dto: CreatePackageDto,
    @Req() request: ApiRequest,
  ) {
    return this.packages.create(context, params.id, dto, request.requestId);
  }
}
@ApiTags('packages')
@Controller('packages')
@TenantEndpoint(...TENANT_ROLES)
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}
  @Get('lookup')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'BUYER', 'WAREHOUSE')
  @RequirePermissions('packages:lookup')
  @ApiOperation({
    summary: '按原始运单字符串精确查找候选；多个承运商不自动选第一项，未知返回空数组',
  })
  @ApiArrayResponse(PackageLookupResultDto)
  lookup(@CurrentTenant() context: TenantContext, @Query() query: PackageLookupQueryDto) {
    return this.packages.lookup(context, query.trackingNo);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('packages:read')
  @ApiOperation({ summary: '当前商家包裹详情，预计数量和实际收货分开展示；VIEWER 隐藏备注' })
  @ApiDataResponse(PackageResultDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: PackageIdDto) {
    return this.packages.detail(context, params.id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('packages:write')
  @ApiOperation({
    summary:
      '未收货包裹可改归属/运单/完整预计计划/物流状态；已有收货仅可补充备注，相同 PATCH 无副作用',
  })
  @ApiDataResponse(PackageResultDto)
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: PackageIdDto,
    @Body() dto: UpdatePackageDto,
    @Req() request: ApiRequest,
  ) {
    return this.packages.update(context, params.id, dto, request.requestId);
  }
}
