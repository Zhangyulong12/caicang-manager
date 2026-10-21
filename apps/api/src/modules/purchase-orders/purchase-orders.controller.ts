import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  HttpCode,
  Header,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBody } from '@nestjs/swagger';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import { BusinessException } from '../../common/errors.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import {
  CreatePurchaseDto,
  UpdatePurchaseDto,
  PurchaseIdDto,
  PurchaseListQueryDto,
  PurchaseOrderDto,
} from './purchase.dto.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
@Injectable()
class EmptyActionPipe implements PipeTransform {
  transform(value: unknown) {
    if (
      value !== undefined &&
      (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
    )
      throw new BusinessException('BAD_REQUEST');
    return value;
  }
}
@ApiTags('purchase-orders')
@Controller('purchase-orders')
@TenantEndpoint(...TENANT_ROLES)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('purchase:read')
  @ApiOperation({ summary: '当前商家采购单搜索、分页、状态/平台/仓库筛选' })
  @ApiPageResponse(PurchaseOrderDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: PurchaseListQueryDto) {
    return this.orders.list(context, query);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('purchase:read')
  @ApiOperation({ summary: '采购单详情、原始价格及实际收货数量；VIEWER 隐藏收货资料' })
  @ApiDataResponse(PurchaseOrderDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: PurchaseIdDto) {
    return this.orders.detail(context, params.id);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({ summary: '新建采购草稿（真实成本预览），不修改库存' })
  @ApiDataResponse(PurchaseOrderDto, 201)
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreatePurchaseDto,
    @Req() request: ApiRequest,
  ) {
    return this.orders.create(context, dto, request.requestId);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({ summary: '仅编辑无后续单据的草稿；items 为完整替换，省略字段不变' })
  @ApiDataResponse(PurchaseOrderDto)
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseIdDto,
    @Body() dto: UpdatePurchaseDto,
    @Req() request: ApiRequest,
  ) {
    return this.orders.update(context, params.id, dto, request.requestId);
  }
  @Post(':id/place')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({
    summary: '确认下单，冻结明细价格/数量、运费分摊与商品快照；PLACED 重复确认不重复审计',
  })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @ApiDataResponse(PurchaseOrderDto)
  place(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseIdDto,
    @Req() request: ApiRequest,
    @Body(new EmptyActionPipe()) body: unknown,
  ) {
    void body;
    return this.orders.place(context, params.id, request.requestId);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('purchase:write')
  @ApiOperation({ summary: '仅取消无任何收货记录的 DRAFT/PLACED；重复取消无副作用' })
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false, maxProperties: 0 },
  })
  @ApiDataResponse(PurchaseOrderDto)
  cancel(
    @CurrentTenant() context: TenantContext,
    @Param() params: PurchaseIdDto,
    @Req() request: ApiRequest,
    @Body(new EmptyActionPipe()) body: unknown,
  ) {
    void body;
    return this.orders.cancel(context, params.id, request.requestId);
  }
}
