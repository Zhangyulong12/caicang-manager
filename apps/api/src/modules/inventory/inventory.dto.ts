import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { STOCK_MOVEMENT_TYPES, type StockMovementType } from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

const present = (_object: unknown, value: unknown) => value !== undefined;
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
/** 只允许可打印字符，避免控制符进入 LIKE 模式。 */
const printable = /^[^\p{Cc}\p{Cs}]+$/u;

/** 库存查询的公共筛选：商品（ID/SKU/条码/子串）+ 仓库。 */
class InventoryFilterQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: '只看某个仓库' })
  @ValidateIf(present)
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: '只看某个商品' })
  @ValidateIf(present)
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ maxLength: 80, example: 'CHARGER-20W', description: '精确 SKU' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(printable)
  sku?: string;

  @ApiPropertyOptional({
    maxLength: 128,
    example: '06912345678901',
    description: '精确条码，保留前导零与大小写',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(printable)
  barcode?: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'SKU / 商品名称 / 条码的字面子串（不区分大小写）',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(printable)
  search?: string;
}

export class InventoryBalanceQueryDto extends InventoryFilterQueryDto {
  @ApiPropertyOptional({
    description: '库存行最近变动时间下界（ISO 8601，含边界）；用于筛"最近有变动"的库存',
  })
  @ValidateIf(present)
  @IsDateString()
  updatedFrom?: string;

  @ApiPropertyOptional({ description: '库存行最近变动时间上界（ISO 8601，含边界）' })
  @ValidateIf(present)
  @IsDateString()
  updatedTo?: string;
}

export class InventoryMovementQueryDto extends InventoryFilterQueryDto {
  @ApiPropertyOptional({ enum: STOCK_MOVEMENT_TYPES, description: '操作类型' })
  @ValidateIf(present)
  @IsIn(STOCK_MOVEMENT_TYPES)
  type?: StockMovementType;

  @ApiPropertyOptional({
    description: '发生时间下界（ISO 8601，含边界）。只写日期表示当天 00:00:00Z',
  })
  @ValidateIf(present)
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: '发生时间上界（ISO 8601，含边界）。只写日期表示当天 23:59:59.999Z',
  })
  @ValidateIf(present)
  @IsDateString()
  to?: string;
}

export class InventoryBalanceDto {
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty({ type: String, nullable: true }) barcode!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) specification!: string | null;
  @ApiProperty() unit!: string;
  @ApiProperty({ description: '现存数量' }) quantityOnHand!: number;
  @ApiProperty({ description: '采购待入库数量' }) pendingInboundQuantity!: number;
  @ApiProperty({ description: '移动加权平均成本，四位小数' }) averageCost!: string;
  @ApiProperty({ description: '库存账面总成本，四位小数' }) totalCost!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) updatedAt!: string | null;
}

export class InventoryMovementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'date-time' }) occurredAt!: string;
  @ApiProperty({ enum: STOCK_MOVEMENT_TYPES }) type!: StockMovementType;
  @ApiProperty({ enum: ['IN', 'OUT'] }) direction!: 'IN' | 'OUT';
  @ApiProperty({ description: '带符号的数量变动' }) quantityDelta!: number;
  @ApiProperty({ description: '操作前库存' }) quantityBefore!: number;
  @ApiProperty({ description: '操作后库存' }) quantityAfter!: number;
  @ApiProperty() costDelta!: string;
  @ApiProperty({ description: '本笔单位成本，四位小数' }) unitCost!: string;
  @ApiProperty() totalCostBefore!: string;
  @ApiProperty() totalCostAfter!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ description: '来源单据类型' }) sourceType!: string;
  @ApiProperty({ type: String, nullable: true }) sourceNo!: string | null;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ format: 'uuid' }) operatorId!: string;
  @ApiProperty() operatorName!: string;
}
