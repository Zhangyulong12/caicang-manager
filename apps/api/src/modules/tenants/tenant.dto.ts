import { Transform } from 'class-transformer';
import { IsString, MinLength, MaxLength, NotContains } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  TENANT_PERMISSIONS,
  TENANT_ROLES,
  type TenantPermission,
  type TenantRole,
} from '@caicang/api-contract';

export class CreateTenantDto {
  @ApiProperty({ example: '我的商家', minLength: 1, maxLength: 150 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @NotContains('\u0000')
  name!: string;
}
export class TenantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class MembershipDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: TENANT_ROLES }) role!: TenantRole;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class DefaultWarehouseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ example: 'DEFAULT' }) code!: string;
  @ApiProperty({ example: '默认仓库' }) name!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class CreatedTenantDto {
  @ApiProperty({ type: TenantDto }) tenant!: TenantDto;
  @ApiProperty({ type: MembershipDto }) membership!: MembershipDto;
  @ApiProperty({ type: DefaultWarehouseDto }) defaultWarehouse!: DefaultWarehouseDto;
}
export class CurrentTenantDto {
  @ApiProperty({ type: TenantDto }) tenant!: TenantDto;
  @ApiProperty({ type: MembershipDto }) membership!: MembershipDto;
  @ApiProperty({ enum: TENANT_PERMISSIONS, isArray: true }) permissions!: TenantPermission[];
}

export class TenantChoiceDto {
  @ApiProperty({ type: TenantDto }) tenant!: TenantDto;
  @ApiProperty({ type: MembershipDto }) membership!: MembershipDto;
}
