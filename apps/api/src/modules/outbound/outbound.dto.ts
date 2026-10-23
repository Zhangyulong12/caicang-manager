import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotContains,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OUTBOUND_STATUSES, type OutboundStatus } from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

const present = (_: unknown, value: unknown) => value !== undefined;
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** 手机号只做宽松校验：仓库可能填写带区号、分机或空格的号码。 */
const PHONE = /^[0-9+\-() ]+$/;

export class OutboundItemInputDto {
  @ApiProperty({ format: 'uuid', description: '必须属于当前商家的商品' })
  @IsUUID()
  productId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647, example: 3, description: '本次出库数量' })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
const uniqueProducts = (row: OutboundItemInputDto) =>
  typeof row?.productId === 'string' ? row.productId.toLowerCase() : row?.productId;

/**
 * 草稿只接受"要发什么、发给谁"。仓库归属、单号、成本、库存与合计都由服务端推导，
 * 未知字段会被全局 whitelist 管道拒绝，因此客户端提交 quantityOnHand/totalCost 会直接 400。
 */
export class CreateOutboundOrderDto {
  @ApiProperty({ format: 'uuid', description: '发货仓库，库存从该仓库扣减' })
  @IsUUID()
  warehouseId!: string;
  @ApiProperty({ type: [OutboundItemInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique(uniqueProducts)
  @ValidateNested({ each: true })
  @Type(() => OutboundItemInputDto)
  items!: OutboundItemInputDto[];
  @ApiPropertyOptional({ maxLength: 100, description: '收件人；草稿可留空，发货前必须补齐' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(100)
  @NotContains('\u0000')
  customerName?: string;
  @ApiPropertyOptional({ maxLength: 50, description: '联系电话；草稿可留空，发货前必须补齐' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(50)
  @Matches(PHONE)
  customerPhone?: string;
  @ApiPropertyOptional({ maxLength: 500, description: '收件地址；草稿可留空，发货前必须补齐' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(500)
  @NotContains('\u0000')
  customerAddress?: string;
  @ApiPropertyOptional({ maxLength: 40, description: '快递公司编码，如 SF / YTO' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(40)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  carrierCode?: string;
  @ApiPropertyOptional({ maxLength: 128, description: '发货运单号，按字符串保存，前导零保留' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  trackingNo?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Trim()
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}

/**
 * PATCH 是"整单替换"语义：给了 `items` 就替换全部行，没给就保留。
 * 所有字段可选，但至少要有一个，否则请求本身没有意义。
 */
export class UpdateOutboundOrderDto {
  @ApiPropertyOptional({ format: 'uuid', description: '换一个发货仓库（仅草稿）' })
  @ValidateIf(present)
  @IsUUID()
  warehouseId?: string;
  @ApiPropertyOptional({ type: [OutboundItemInputDto], minItems: 1, maxItems: 100 })
  @ValidateIf(present)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique(uniqueProducts)
  @ValidateNested({ each: true })
  @Type(() => OutboundItemInputDto)
  items?: OutboundItemInputDto[];
  @ApiPropertyOptional({ maxLength: 100 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(100)
  @NotContains('\u0000')
  customerName?: string;
  @ApiPropertyOptional({ maxLength: 50 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(50)
  @Matches(PHONE)
  customerPhone?: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(500)
  @NotContains('\u0000')
  customerAddress?: string;
  @ApiPropertyOptional({ maxLength: 40 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(40)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  carrierCode?: string;
  @ApiPropertyOptional({ maxLength: 128 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  trackingNo?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Trim()
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}

/** 确认发货只接受幂等操作 ID 与发货时才能确定的物流信息，数量与成本一律以服务端为准。 */
export class ShipOutboundOrderDto {
  @ApiProperty({
    format: 'uuid',
    description: '客户端幂等操作 ID；同 ID 同请求返回原发货结果，同 ID 不同请求返回 409',
  })
  @IsUUID()
  clientOperationId!: string;
  @ApiPropertyOptional({ maxLength: 40, description: '快递公司编码，覆盖草稿里的值' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(40)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  carrierCode?: string;
  @ApiPropertyOptional({ maxLength: 128, description: '发货运单号，覆盖草稿里的值' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  trackingNo?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Trim()
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}

export class OutboundOrderListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: '只看某个仓库的出库单' })
  @ValidateIf(present)
  @IsUUID()
  warehouseId?: string;
  @ApiPropertyOptional({ enum: OUTBOUND_STATUSES, description: '按状态过滤' })
  @ValidateIf(present)
  @IsIn(OUTBOUND_STATUSES)
  status?: OutboundStatus;
  @ApiPropertyOptional({
    maxLength: 200,
    description: '出库单号、运单号、收件人或联系电话的字面子串（不区分大小写）',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  @MinLength(1)
  @MaxLength(200)
  @NotContains('\u0000')
  search?: string;
  @ApiPropertyOptional({
    description: '创建时间下界（ISO 8601，含边界）；只写日期表示当天 00:00:00Z',
  })
  @ValidateIf(present)
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({
    description: '创建时间上界（ISO 8601，含边界）；只写日期表示当天 23:59:59.999Z',
  })
  @ValidateIf(present)
  @IsDateString()
  to?: string;
  @ApiPropertyOptional({ description: '仅看某个商品的出库单' })
  @ValidateIf(present)
  @IsUUID()
  productId?: string;
}

export class OutboundOrderIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}

export class OutboundItemResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '移动加权平均成本快照，四位小数；草稿为 null',
  })
  shippedUnitCost!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '数量 × 成本快照，四位小数；草稿为 null',
  })
  lineCost!: string | null;
  @ApiProperty({ description: '当前该仓库可出库数量（实时读 stock_balances）' })
  availableQuantity!: number;
}

export class OutboundOrderResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() outboundNo!: string;
  @ApiProperty({ enum: OUTBOUND_STATUSES }) status!: OutboundStatus;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ type: String, nullable: true }) customerName!: string | null;
  @ApiProperty({ type: String, nullable: true }) customerPhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) customerAddress!: string | null;
  @ApiProperty({ type: String, nullable: true }) carrierCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) trackingNo!: string | null;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() createdByName!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) shippedBy!: string | null;
  @ApiProperty({ type: String, nullable: true }) shippedByName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) confirmOperationId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) shippedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty() totalQuantity!: number;
  @ApiProperty({ description: '本单出库成本合计，四位小数；草稿为 0.0000' }) totalCost!: string;
  @ApiProperty({ type: [OutboundItemResultDto] }) items!: OutboundItemResultDto[];
}

/** 取消只改状态，不动库存；拒绝原因放在 details 里说明。 */
export class CancelOutboundResultDto {
  @ApiProperty({ enum: OUTBOUND_STATUSES }) status!: OutboundStatus;
  @ApiProperty({ description: '本次调用是否真的把草稿改成已取消；重复取消为 false' })
  cancelled!: boolean;
}
