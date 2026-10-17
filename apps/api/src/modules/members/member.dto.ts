import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, IsIn, IsBoolean, IsUUID, ValidateIf } from 'class-validator';
import { TENANT_ROLES, type TenantRole } from '@caicang/api-contract';
import { MembershipDto } from '../tenants/tenant.dto.js';

export class AddMemberDto {
  @ApiProperty({ example: 'registered@example.com', format: 'email', maxLength: 320 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;
  @ApiProperty({
    enum: TENANT_ROLES,
    example: 'BUYER',
    description: 'OWNER 仅在创建商家时产生；ADMIN 操作者只可授予普通三类角色',
  })
  @IsIn(TENANT_ROLES)
  role!: TenantRole;
}
export class UpdateMemberDto {
  @ApiPropertyOptional({
    enum: TENANT_ROLES,
    example: 'WAREHOUSE',
    description: '不开放 OWNER 变更，至少提供 role/isActive 其中一项',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsIn(TENANT_ROLES)
  role?: TenantRole;
  @ApiPropertyOptional({ example: true })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
export class MembershipIdDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() membershipId!: string;
}
export class MemberUserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() isActive!: boolean;
}
export class MemberDto extends MembershipDto {
  @ApiProperty({ type: MemberUserDto }) user!: MemberUserDto;
}
