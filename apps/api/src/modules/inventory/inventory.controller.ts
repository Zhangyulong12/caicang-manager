import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import { RequirePermissions, TenantEndpoint } from '../../common/tenancy/tenant.decorators.js';
import { InventoryService } from './inventory.service.js';
import {
  InventoryBalanceDto,
  InventoryBalanceQueryDto,
  InventoryMovementDto,
  InventoryMovementQueryDto,
  InventoryPendingDto,
  InventoryPendingQueryDto,
  InventorySummaryDto,
} from './inventory.dto.js';

/**
 * 库存是只读视图：这里只有 GET，没有 POST/PATCH/PUT/DELETE。
 * 库存数量只能由收货等业务事务改变（写 stock_movements 并同步 stock_balances），
 * 不提供任何直接改余额的 CRUD 接口。
 */
@ApiTags('inventory')
@Controller('inventory')
@TenantEndpoint(...TENANT_ROLES)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('summary')
  @RequirePermissions('products:read')
  @ApiOperation({
    summary: '库存总览：商品/仓库数、现存合计、账面总成本、待入库与分仓明细',
    description:
      '全部由 stock_balances、未收完的采购行与收货记录实时算出；generatedAt 是服务端计算时间。',
  })
  @ApiDataResponse(InventorySummaryDto)
  summary(@CurrentTenant() context: TenantContext) {
    return this.inventory.summary(context);
  }
  @Get('balances')
  @RequirePermissions('products:read')
  @ApiOperation({
    summary: '库存余额查询：现存数量、采购待入库、移动加权平均成本与账面总成本',
    description:
      '按商家隔离，可按仓库/商品/SKU/条码/子串筛选并分页；现存数量直接读 stock_balances，' +
      '待入库为已下单未收数量，平均成本 = 账面总成本 / 现存数量。',
  })
  @ApiPageResponse(InventoryBalanceDto)
  balances(@CurrentTenant() context: TenantContext, @Query() query: InventoryBalanceQueryDto) {
    return this.inventory.balances(context, query);
  }
  @Get('pending')
  @RequirePermissions('products:read')
  @ApiOperation({
    summary: '待入库采购商品：已下单未收完的采购行，含订单、仓库、剩余数量与金额',
    description:
      '只统计状态为 PLACED / PARTIAL_RECEIVED 且仍有剩余数量的采购行；可按仓库/商品/SKU/条码/单号搜索，按采购日期筛选。',
  })
  @ApiPageResponse(InventoryPendingDto)
  pending(@CurrentTenant() context: TenantContext, @Query() query: InventoryPendingQueryDto) {
    return this.inventory.pending(context, query);
  }
  @Get('movements')
  @RequirePermissions('products:read')
  @ApiOperation({
    summary: '库存变动流水：时间、类型、数量、操作前后库存、来源单据与操作人',
    description:
      '按时间倒序分页；可按商品/仓库/类型/时间区间筛选，支持 SKU、条码与子串搜索。' +
      '流水不可修改，是库存数量的事实来源。',
  })
  @ApiPageResponse(InventoryMovementDto)
  movements(@CurrentTenant() context: TenantContext, @Query() query: InventoryMovementQueryDto) {
    return this.inventory.movements(context, query);
  }
}
