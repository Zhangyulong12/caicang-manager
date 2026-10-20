import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TENANT_ROLES } from '@caicang/api-contract';
import { ApiArrayResponse, ApiDataResponse, ApiPageResponse } from '../../common/api-docs.js';
import type { ApiRequest } from '../../common/request-context.js';
import { CurrentTenant, type TenantContext } from '../../common/tenancy/tenant-context.js';
import {
  RequirePermissions,
  Roles,
  TenantEndpoint,
} from '../../common/tenancy/tenant.decorators.js';
import { ProductsService } from './products.service.js';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductDto,
  ProductListQueryDto,
  ProductLookupQueryDto,
  ProductIdDto,
} from './product.dto.js';

@ApiTags('products')
@Controller('products')
@TenantEndpoint(...TENANT_ROLES)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}
  @Get()
  @RequirePermissions('products:read')
  @ApiOperation({ summary: '搜索、分页及筛选当前商家商品' })
  @ApiPageResponse(ProductDto)
  list(@CurrentTenant() context: TenantContext, @Query() query: ProductListQueryDto) {
    return this.products.list(context, query);
  }

  // Static path must precede :id, so lookup never enters UUID validation.
  @Get('lookup')
  @RequirePermissions('products:read')
  @ApiOperation({
    summary: '按精确 SKU 或条码查启用商品',
    description: '保留前导零/大小写；data 为 0–2 个候选，不猜第一个。仅匹配停用商品时为空。',
  })
  @ApiArrayResponse(ProductDto, 2)
  lookup(@CurrentTenant() context: TenantContext, @Query() query: ProductLookupQueryDto) {
    return this.products.lookup(context, query.code);
  }

  @Get(':id')
  @RequirePermissions('products:read')
  @ApiOperation({ summary: '读取当前商家商品详情（含停用）' })
  @ApiDataResponse(ProductDto)
  detail(@CurrentTenant() context: TenantContext, @Param() params: ProductIdDto) {
    return this.products.detail(context, params.id);
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('products:write')
  @ApiOperation({
    summary: '创建商品',
    description:
      'SKU/非空条码在商家内唯一；参考进货价必须是十进制字符串或 null，不影响历史采购价格。',
  })
  @ApiDataResponse(ProductDto, 201)
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateProductDto,
    @Req() request: ApiRequest,
  ) {
    return this.products.create(context, dto, request.requestId);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'BUYER')
  @RequirePermissions('products:write')
  @ApiOperation({
    summary: '修改或停用商品，保留历史订单',
    description:
      '至少一个字段；省略不改，nullable 字段可 null 清空；不开放删除或修改历史订单价格。',
  })
  @ApiDataResponse(ProductDto)
  update(
    @CurrentTenant() context: TenantContext,
    @Param() params: ProductIdDto,
    @Body() dto: UpdateProductDto,
    @Req() request: ApiRequest,
  ) {
    return this.products.update(context, params.id, dto, request.requestId);
  }
}
