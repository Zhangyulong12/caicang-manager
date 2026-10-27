import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
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
import { PURCHASE_RETURN_STATUSES, type PurchaseReturnStatus } from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const present = (_: unknown, value: unknown) => value !== undefined;
export class PurchaseReturnLineInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() purchaseOrderItemId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
  @ApiPropertyOptional({
    format: 'uuid',
    description: '指定原入库明细；省略时确认时按原入库日期、ID 顺序分配',
  })
  @ValidateIf(present)
  @IsUUID()
  receiptItemId?: string;
}
export class CreatePurchaseReturnDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() purchaseOrderId!: string;
  @ApiProperty({ maxLength: 500, example: '商品破损，退给原供应商' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @NotContains('\u0000')
  reason!: string;
  @ApiProperty({ format: 'date', example: '2026-10-25' })
  @IsString()
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  returnDate!: string;
  @ApiPropertyOptional({
    type: String,
    default: '0.00',
    description: '实际退款金额，人民币元，独立于库存退货成本；确认时冻结，不代表支付系统已收款',
  })
  @ValidateIf(present)
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/)
  refundAmount?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Trim()
  @ValidateIf((_, v: unknown) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
  @ApiProperty({ type: [PurchaseReturnLineInputDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique((row: PurchaseReturnLineInputDto) =>
    typeof row?.purchaseOrderItemId === 'string'
      ? row.purchaseOrderItemId.toLowerCase()
      : row?.purchaseOrderItemId,
  )
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnLineInputDto)
  items!: PurchaseReturnLineInputDto[];
}
export class UpdatePurchaseReturnDto extends PartialType(
  OmitType(CreatePurchaseReturnDto, ['purchaseOrderId'] as const),
  { skipNullProperties: false },
) {}
export class ConfirmPurchaseReturnDto {
  @ApiProperty({ format: 'uuid', description: '同一商家内唯一；同号同单重放，不同单复用冲突' })
  @IsUUID()
  clientOperationId!: string;
}
export class PurchaseReturnIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}
export class PurchaseReturnListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @ValidateIf(present) @IsUUID() purchaseOrderId?: string;
  @ApiPropertyOptional({ enum: PURCHASE_RETURN_STATUSES })
  @ValidateIf(present)
  @IsIn(PURCHASE_RETURN_STATUSES)
  status?: PurchaseReturnStatus;
  @ApiPropertyOptional({ maxLength: 100 })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MaxLength(100)
  @NotContains('\u0000')
  search?: string;
  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(present)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from?: string;
  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(present)
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to?: string;
}
export class PurchaseReturnAllocationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) receiptId!: string;
  @ApiProperty() receiptNo!: string;
  @ApiProperty({ format: 'uuid' }) receiptItemId!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: String }) receivedUnitCost!: string;
  @ApiProperty({ type: String }) receivedCost!: string;
}
export class PurchaseReturnItemDto {
  @ApiProperty({ description: '原采购商品实付金额按退货数量比例估算，不含运费', type: String })
  estimatedRefundAmount!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderItemId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) requestedReceiptItemId!:
    string | null;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: String, nullable: true }) stockUnitCost!: string | null;
  @ApiProperty({ type: String, nullable: true }) stockCost!: string | null;
  @ApiProperty({ type: [PurchaseReturnAllocationDto] }) allocations!: PurchaseReturnAllocationDto[];
}
export class PurchaseReturnDto {
  @ApiProperty({ type: String, nullable: true }) confirmedByName!: string | null;
  @ApiProperty({ description: '各行退款预估合计；非实际退款、非库存成本', type: String })
  estimatedRefundAmount!: string;
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string;
  @ApiProperty() purchaseOrderNo!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() warehouseName!: string;
  @ApiProperty() returnNo!: string;
  @ApiProperty({ enum: PURCHASE_RETURN_STATUSES }) status!: PurchaseReturnStatus;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'date' }) returnDate!: string;
  @ApiProperty({ example: '35.00' }) refundAmount!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '确认时按移动加权平均扣除的库存成本，四位小数',
  })
  stockCost!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: '关联原入库明细的历史成本合计，四位小数，仅用于追溯',
  })
  receivedCost!: string | null;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ format: 'uuid' }) createdBy!: string;
  @ApiProperty() createdByName!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) confirmedBy!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) confirmedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) confirmOperationId!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [PurchaseReturnItemDto] }) items!: PurchaseReturnItemDto[];
}
export class ReturnableReceiptDto {
  @ApiProperty({ format: 'uuid' }) receiptId!: string;
  @ApiProperty() receiptNo!: string;
  @ApiProperty({ format: 'uuid' }) receiptItemId!: string;
  @ApiProperty({ format: 'date-time' }) receivedAt!: string;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty() returnedQuantity!: number;
  @ApiProperty() availableQuantity!: number;
}
export class ReturnableItemDto {
  @ApiProperty() orderedQuantity!: number;
  @ApiProperty({ type: String, description: '原采购行数量×原价−行优惠，不含运费' })
  purchaseNetAmount!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderItemId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty() returnedQuantity!: number;
  @ApiProperty() availableQuantity!: number;
  @ApiProperty({ description: '当前仓库可用库存，仅供参考，确认事务重新检查' })
  stockQuantity!: number;
  @ApiProperty({ type: [ReturnableReceiptDto] }) receipts!: ReturnableReceiptDto[];
}
export class PurchaseReturnableDto {
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string;
  @ApiProperty() orderNo!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ type: [ReturnableItemDto] }) items!: ReturnableItemDto[];
}
