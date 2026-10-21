import type {
  ApiResponse,
  ApiPageResponse,
  ProductData,
  WarehouseData,
  TenantPermission,
} from '@caicang/api-contract';
import { ApiFailure } from './client';
import {
  productErrors,
  warehouseErrors,
  productPayload,
  warehousePayload,
  type ProductForm,
  type WarehouseForm,
} from './catalog-form';
export interface CatalogScope {
  userId: string;
  sessionKey: string;
  tenantId: string;
  permissions: readonly TenantPermission[];
}
export interface CatalogClient {
  request<T>(
    path: string,
    init?: { method?: string; body?: unknown; tenantId?: string },
  ): Promise<ApiResponse<T>>;
}
export function createCatalog(
  client: CatalogClient,
  scope: () => CatalogScope | null,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
) {
  function capture(permission: TenantPermission) {
    const current = scope();
    if (!current || !current.permissions.includes(permission))
      throw new ApiFailure(403, 'FORBIDDEN', '当前角色没有此操作权限');
    return { ...current };
  }
  function check(expected: CatalogScope) {
    const current = scope();
    if (
      !current ||
      current.userId !== expected.userId ||
      current.sessionKey !== expected.sessionKey ||
      current.tenantId !== expected.tenantId
    )
      throw new ApiFailure(409, 'SCOPE_CHANGED', '工作空间已切换，请重新打开页面');
  }
  async function request<T>(
    permission: TenantPermission,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ) {
    const current = capture(permission);
    const result = await client.request<T>(path, { ...init, tenantId: current.tenantId });
    check(current);
    return result;
  }
  function preferenceKey(current: CatalogScope) {
    return `caicang.warehouse.${current.userId}.${current.tenantId}`;
  }
  async function activeWarehouses(current: CatalogScope): Promise<WarehouseData[]> {
    const result: WarehouseData[] = [];
    for (let page = 1; ; page++) {
      const response = (await request<WarehouseData[]>(
        'warehouses:read',
        `/warehouses?page=${page}&pageSize=100`,
      )) as ApiPageResponse<WarehouseData>;
      check(current);
      if (response.data.some((row) => row.tenantId !== current.tenantId))
        throw new ApiFailure(502, 'INVALID_RESPONSE', '仓库数据范围异常，请重试');
      result.push(...response.data.filter((row) => row.isActive));
      if (page * 100 >= response.pagination.total) return result;
      if (!response.data.length)
        throw new ApiFailure(502, 'INVALID_RESPONSE', '仓库分页异常，请重试');
    }
  }
  return {
    async products(query: { page: number; pageSize: number; search?: string; isActive?: boolean }) {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search?.trim()) params.set('search', query.search.trim());
      if (query.isActive !== undefined) params.set('isActive', String(query.isActive));
      return (await request<ProductData[]>(
        'products:read',
        '/products?' + params,
      )) as ApiPageResponse<ProductData>;
    },
    async product(id: string) {
      return (await request<ProductData>('products:read', '/products/' + encodeURIComponent(id)))
        .data;
    },
    async saveProduct(form: ProductForm, id?: string) {
      if (Object.keys(productErrors(form)).length)
        throw new ApiFailure(400, 'VALIDATION_ERROR', '请修正商品表单后再保存');
      return (
        await request<ProductData>(
          'products:write',
          id ? '/products/' + encodeURIComponent(id) : '/products',
          { method: id ? 'PATCH' : 'POST', body: productPayload(form) },
        )
      ).data;
    },
    async setActive(id: string, isActive: boolean) {
      return (
        await request<ProductData>('products:write', '/products/' + encodeURIComponent(id), {
          method: 'PATCH',
          body: { isActive },
        })
      ).data;
    },
    async warehouses(page = 1, pageSize = 20) {
      return (await request<WarehouseData[]>(
        'warehouses:read',
        `/warehouses?page=${page}&pageSize=${pageSize}`,
      )) as ApiPageResponse<WarehouseData>;
    },
    async saveWarehouse(form: WarehouseForm) {
      if (Object.keys(warehouseErrors(form)).length)
        throw new ApiFailure(400, 'VALIDATION_ERROR', '请修正仓库表单后再保存');
      return (
        await request<WarehouseData>('warehouses:write', '/warehouses', {
          method: 'POST',
          body: warehousePayload(form),
        })
      ).data;
    },
    async defaultWarehouse(id?: string) {
      const current = capture('warehouses:read');
      const warehouses = await activeWarehouses(current);
      const requested = id ?? storage.getItem(preferenceKey(current));
      let selected = warehouses.find((row) => row.id === requested);
      if (id && !selected) throw new ApiFailure(404, 'NOT_FOUND', '该仓库已不可用，请重新选择');
      selected ??= warehouses.find((row) => row.code === 'DEFAULT') ?? warehouses[0];
      check(current);
      if (selected) storage.setItem(preferenceKey(current), selected.id);
      else storage.removeItem(preferenceKey(current));
      return selected ?? null;
    },
  };
}
