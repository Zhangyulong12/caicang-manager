import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
import { PaginationQueryDto } from '../../common/pagination.dto.js';
import {
  PACKAGE_STATUSES,
  PACKAGE_LOGISTICS_STATUSES,
  PACKAGE_RECEIVING_STATUSES,
  PURCHASE_STATUSES,
  type PackageLogisticsStatus,
  type PackageStatus,
} from '@caicang/api-contract';

const present = (_: unknown, value: unknown) => value !== undefined;
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const Carrier = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
const QueryBoolean = () =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );

export class ExpectedItemInputDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() purchaseOrderItemId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647, example: 30 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  expectedQuantity!: number;
}
export class CreatePackageDto {
  @ApiProperty({ maxLength: 40, example: 'ZTO', description: '快递公司编码，首尾去空格并转大写' })
  @Carrier()
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/)
  carrierCode!: string;
  @ApiProperty({
    type: String,
    maxLength: 128,
    example: '000783456123',
    description: '字符串，保留前导零、大小写及内部字符',
  })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  trackingNo!: string;
  @ApiPropertyOptional({
    type: [ExpectedItemInputDto],
    default: [],
    maxItems: 100,
    description: '可为空；同采购行不可重复',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique((row: ExpectedItemInputDto) =>
    typeof row?.purchaseOrderItemId === 'string'
      ? row.purchaseOrderItemId.toLowerCase()
      : row?.purchaseOrderItemId,
  )
  @ValidateNested({ each: true })
  @Type(() => ExpectedItemInputDto)
  expectedItems?: ExpectedItemInputDto[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;
}
export class UpdatePackageDto extends PartialType(CreatePackageDto, { skipNullProperties: false }) {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '仅未收货包裹可更换采购单；变更时必须同时提供完整 expectedItems（可为空）',
  })
  @ValidateIf(present)
  @IsUUID()
  purchaseOrderId?: string;
  @ApiPropertyOptional({
    enum: PACKAGE_LOGISTICS_STATUSES,
    description: '仅物流阶段允许的状态，不可伪造 PARTIAL_RECEIVED/RECEIVED',
  })
  @ValidateIf(present)
  @IsIn(PACKAGE_LOGISTICS_STATUSES)
  status?: PackageLogisticsStatus;
}
export class PackageIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
}
export class PackageListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    maxLength: 200,
    description: '运单号、快递公司、采购单号、商品 SKU 或名称的字面子串（不区分大小写）',
  })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @NotContains('\u0000')
  search?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '仅列出该采购单下的包裹' })
  @ValidateIf(present)
  @IsUUID()
  purchaseOrderId?: string;
  @ApiPropertyOptional({ maxLength: 40, example: 'ZTO', description: '快递公司编码，精确匹配' })
  @Carrier()
  @ValidateIf(present)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/)
  carrierCode?: string;
  @ApiPropertyOptional({ enum: PACKAGE_STATUSES, description: '包裹物流状态' })
  @ValidateIf(present)
  @IsIn(PACKAGE_STATUSES)
  status?: PackageStatus;
  @ApiPropertyOptional({
    type: Boolean,
    description: 'true 仅看已有收货记录的包裹，false 仅看尚无收货记录的包裹',
  })
  @QueryBoolean()
  @ValidateIf(present)
  @IsBoolean()
  hasReceipts?: boolean;
}
export class PackageLookupQueryDto {
  @ApiProperty({ type: String, maxLength: 128, example: '000783456123' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  trackingNo!: string;
}
export class ExpectedItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderItemId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() orderedQuantity!: number;
  @ApiProperty() expectedQuantity!: number;
  @ApiProperty() receivedQuantity!: number;
}
export class PackageResultDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string;
  @ApiProperty() purchaseOrderNo!: string;
  @ApiProperty({ enum: PURCHASE_STATUSES }) purchaseStatus!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ type: String, nullable: true }) carrierCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) trackingNo!: string | null;
  @ApiProperty({ enum: PACKAGE_STATUSES }) status!: string;
  @ApiProperty({
    enum: PACKAGE_RECEIVING_STATUSES,
    description: '根据实际收货数量及明确完成标记推导，不以物流 ARRIVED 为依据',
  })
  receivingStatus!: string;
  @ApiProperty() hasReceipts!: boolean;
  @ApiProperty() receivedQuantity!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) receivingClosedAt!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) remark!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: [ExpectedItemDto] }) expectedItems!: ExpectedItemDto[];
}
export class PackageLookupResultDto {
  @ApiProperty({ format: 'uuid' }) packageId!: string;
  @ApiProperty({ type: String, nullable: true }) carrierCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) trackingNo!: string | null;
  @ApiProperty({ format: 'uuid' }) purchaseOrderId!: string;
  @ApiProperty() purchaseOrderNo!: string;
  @ApiProperty({ enum: PACKAGE_STATUSES }) packageStatus!: string;
  @ApiProperty({ enum: PACKAGE_RECEIVING_STATUSES }) receivingStatus!: string;
}
