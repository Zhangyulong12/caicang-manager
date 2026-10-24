import { Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
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
import { AdjustmentsService } from './adjustments.service.js';
import {
  AdjustmentListQueryDto,
  CreateAdjustmentDto,
  StockAdjustmentDto,
} from './adjustment.dto.js';

class AdjustmentIdDto {
  @IsUUID() id!: string;
}

/**
 * 库存调整是唯一允许"直接改数量"的入口，但改的仍然不是余额本身：
 * 每次调整都在一个事务里写调整单 + 流水 + 余额 + 审计，余额只是流水的结果。
 */
@ApiTags('inventory')
@Controller('inventory/adjustments')
@TenantEndpoint(...TENANT_ROLES)
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'WAREHOUSE')
  @RequirePermissions('inventory:write')
  @ApiOperation({
    summary: '登记库存调整：正数增加、负数减少，同事务写流水/余额/审计；clientOperationId 幂等',
    description:
      '原因限定为盘点盘盈/盘亏、商品损坏、商品丢失、其他原因，盘盈只能加、盘亏损坏丢失只能减。' +
      '成本由服务端按移动加权平均推导（零库存盘盈用参考进货价），客户端不能提交余额或成本。',
  })
  @ApiDataResponse(StockAdjustmentDto, 201)
  @ApiDataResponse(StockAdjustmentDto, 200)
  async create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateAdjustmentDto,
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adjustments.create(context, dto, request.requestId);
    // 201 首次登记；200 是完全相同的幂等重放，不会再动一次库存。
    response.status(result.created ? 201 : 200);
    return result.data;
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: '库存调整分页列表，可按仓库/商品/原因/日期与关键字筛选' })
  @ApiPageResponse(StockAdjustmentDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: AdjustmentListQueryDto) {
    return this.adjustments.list(context, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: '库存调整详情，含调整前后数量与成本' })
  @ApiDataResponse(StockAdjustmentDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: AdjustmentIdDto) {
    return this.adjustments.detail(context, params.id);
  }
}
