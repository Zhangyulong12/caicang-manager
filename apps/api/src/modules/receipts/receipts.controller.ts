import { Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { ReceiptsService } from './receipts.service.js';
import {
  CreateReceiptDto,
  ReceiptIdDto,
  ReceiptListQueryDto,
  ReceiptResultDto,
} from './receipt.dto.js';

@ApiTags('receipts')
@Controller('receipts')
@TenantEndpoint(...TENANT_ROLES)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('receiving:confirm')
  @ApiOperation({
    summary:
      '确认一次验收入库：同事务锁单校验数量上限、写收货单/明细、库存余额与流水、订单与包裹状态、审计；clientOperationId 幂等',
  })
  @ApiDataResponse(ReceiptResultDto, 201)
  @ApiDataResponse(ReceiptResultDto, 200)
  async create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateReceiptDto,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.receipts.create(context, dto, request.requestId);
    // 201 首次创建；200 为完全相同幂等重放，不产生第二张入库单。
    response.status(result.created ? 201 : 200);
    return result.data;
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('packages:read')
  @ApiOperation({ summary: '当前商家入库单分页列表，可按包裹/采购单/单号运单搜索' })
  @ApiPageResponse(ReceiptResultDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: ReceiptListQueryDto) {
    return this.receipts.list(context, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('packages:read')
  @ApiOperation({ summary: '入库单详情，含 SKU、数量与到岸成本快照；VIEWER 隐藏备注' })
  @ApiDataResponse(ReceiptResultDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: ReceiptIdDto) {
    return this.receipts.detail(context, params.id);
  }
}
