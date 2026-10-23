import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { PURCHASE_PLATFORMS, type PurchasePlatform } from '@caicang/api-contract';
import { PaginationQueryDto } from '../../common/pagination.dto.js';

const present = (_object: unknown, value: unknown) => value !== undefined;
const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
// 别名与备注都允许中文，但拒绝控制字符：它们会破坏列表渲染，也常是粘贴密码的痕迹。
const printable = /^[^\p{Cc}\p{Cs}]+$/u;

export class CreatePurchaseAccountDto {
  @ApiProperty({ enum: PURCHASE_PLATFORMS, description: '账号所属平台；有关联采购记录后不可修改' })
  @IsIn(PURCHASE_PLATFORMS)
  platform!: PurchasePlatform;

  @ApiProperty({ maxLength: 100, example: '淘宝主账号' })
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(printable)
  alias!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @Trim()
  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2000)
  @NotContains('\u0000')
  remark?: string | null;

  @ApiPropertyOptional({
    default: true,
    description: '停用后不能用于新建或确认采购，历史记录仍可查询',
  })
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePurchaseAccountDto extends PartialType(CreatePurchaseAccountDto, {
  skipNullProperties: false,
}) {}

export class PurchaseAccountIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class PurchaseAccountQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PURCHASE_PLATFORMS })
  @ValidateIf(present)
  @IsIn(PURCHASE_PLATFORMS)
  platform?: PurchasePlatform;

  @ApiPropertyOptional({ maxLength: 100, description: '账号别名字面子串' })
  @Trim()
  @ValidateIf(present)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @NotContains('\u0000')
  search?: string;

  @ApiPropertyOptional({ type: Boolean })
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @ValidateIf(present)
  @IsBoolean()
  isActive?: boolean;
}

export class PurchaseAccountDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  tenantId!: string;

  @ApiProperty({ enum: PURCHASE_PLATFORMS })
  platform!: PurchasePlatform;

  @ApiProperty({ description: '本商家内的账号别名，同一平台不可重名' })
  alias!: string;

  @ApiProperty({ type: String, nullable: true })
  remark!: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ description: '是否已有采购单引用；有引用时禁止删除与改平台' })
  hasOrders!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PurchaseAccountDeletedDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: '固定为 true；有关联历史的账号不会被删除' })
  deleted!: boolean;
}
