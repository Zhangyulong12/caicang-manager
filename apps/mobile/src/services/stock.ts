import type { InventoryBalanceData, InventoryMovementData } from '@caicang/api-contract';
import type { ApiClient } from '../api/client';

/** 与后端 InventoryFilterQueryDto 的限制保持一致。 */
export const MAX_SCAN_LENGTH = 128;
export const MAX_QUERY_LENGTH = 200;
export const RECENT_MOVEMENT_LIMIT = 20;

export type StockInputCode = 'EMPTY' | 'TOO_LONG' | 'INVALID';

export class StockInputError extends Error {
  readonly code: StockInputCode;

  constructor(code: StockInputCode, message: string) {
    super(message);
    this.name = 'StockInputError';
    this.code = code;
  }
}

/**
 * 扫到的条码是原样字符串：保留前导零（"06912345000017" 不能变成数字），
 * 只裁剪首尾空白并拒绝控制字符——扫码枪偶尔会把不可见字符带进来。
 */
export function normalizeScan(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) throw new StockInputError('EMPTY', '请扫描或输入商品条码');
  if (value.length > MAX_SCAN_LENGTH)
    throw new StockInputError('TOO_LONG', '条码不能超过 ' + MAX_SCAN_LENGTH + ' 个字符');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new StockInputError('INVALID', '条码包含无法识别的控制字符');
  return value;
}

/** 手输查询：商品名称或 SKU 都走子串搜索，空串视为"没输入"。 */
export function normalizeQuery(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) throw new StockInputError('EMPTY', '请输入商品名称或 SKU');
  if (value.length > MAX_QUERY_LENGTH)
    throw new StockInputError('TOO_LONG', '搜索内容不能超过 ' + MAX_QUERY_LENGTH + ' 个字符');
  return value;
}

export type StockMatch = 'barcode' | 'sku' | 'search';

export interface StockLookupResult {
  rows: InventoryBalanceData[];
  /** 命中方式：条码精确 / SKU 精确 / 子串搜索；没查到时为 null。 */
  match: StockMatch | null;
  /** 实际用于展示的查询词（条码则原样返回）。 */
  query: string;
}

// App JS service 不保证提供 URLSearchParams；逐项编码，商品码中的 +、& 和前导零原样传递。
function queryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
    .join('&');
}

function withFilters(params: Record<string, string>, warehouseId?: string): string {
  if (warehouseId) params.warehouseId = warehouseId;
  params.pageSize = '50';
  return queryString(params);
}

/** 手输：名称 / SKU / 条码的子串搜索，交给服务端匹配，前端不做模糊排序。 */
export async function searchStock(
  api: ApiClient,
  input: { text: string; warehouseId?: string; tenantId?: string },
): Promise<StockLookupResult> {
  const query = normalizeQuery(input.text);
  const params = withFilters({ page: '1', search: query }, input.warehouseId);
  const response = await api.request<InventoryBalanceData[]>('/inventory/balances?' + params, {
    tenantId: input.tenantId,
  });
  return { rows: response.data, match: response.data.length ? 'search' : null, query };
}

/**
 * 扫码：先按条码精确查，再按 SKU 精确查（有的商家把条码填成了 SKU），
 * 最后退回子串搜索兜底。三步都是只读查询，不会改库存。
 */
export async function findByCode(
  api: ApiClient,
  raw: string,
  options: { warehouseId?: string; tenantId?: string } = {},
): Promise<StockLookupResult> {
  const code = normalizeScan(raw);
  const attempts: { match: StockMatch; build: () => string }[] = [
    {
      match: 'barcode',
      build: () =>
        '/inventory/balances?' + withFilters({ page: '1', barcode: code }, options.warehouseId),
    },
    {
      match: 'sku',
      build: () =>
        '/inventory/balances?' + withFilters({ page: '1', sku: code }, options.warehouseId),
    },
    {
      match: 'search',
      build: () =>
        '/inventory/balances?' + withFilters({ page: '1', search: code }, options.warehouseId),
    },
  ];
  for (const attempt of attempts) {
    const response = await api.request<InventoryBalanceData[]>(attempt.build(), {
      tenantId: options.tenantId,
    });
    if (response.data.length > 0) return { rows: response.data, match: attempt.match, query: code };
  }
  return { rows: [], match: null, query: code };
}

/** 某个商品在各仓库的余额 + 最近流水；详情页两张表都来自这里。 */
export async function loadProductStock(
  api: ApiClient,
  input: { productId: string; tenantId?: string },
): Promise<{ balances: InventoryBalanceData[] }> {
  const params = queryString({ page: '1', pageSize: '50', productId: input.productId });
  const response = await api.request<InventoryBalanceData[]>('/inventory/balances?' + params, {
    tenantId: input.tenantId,
  });
  return { balances: response.data };
}

export async function loadRecentMovements(
  api: ApiClient,
  input: { productId: string; warehouseId?: string; tenantId?: string; limit?: number },
): Promise<InventoryMovementData[]> {
  const params: Record<string, string> = {
    page: '1',
    pageSize: String(input.limit ?? RECENT_MOVEMENT_LIMIT),
    productId: input.productId,
  };
  if (input.warehouseId) params.warehouseId = input.warehouseId;
  const response = await api.request<InventoryMovementData[]>(
    '/inventory/movements?' + queryString(params),
    {
      tenantId: input.tenantId,
    },
  );
  return response.data;
}

export async function loadWarehouses(
  api: ApiClient,
  tenantId?: string,
): Promise<{ id: string; name: string; code: string; isActive: boolean }[]> {
  const response = await api.request<
    { id: string; name: string; code: string; isActive: boolean }[]
  >('/warehouses?page=1&pageSize=100', { tenantId });
  return response.data.filter((row) => row.isActive);
}

/** 同一商品在多个仓库各有一行；合计只是把这些行加起来给个总览，不改任何数。 */
export function totalOnHand(rows: readonly InventoryBalanceData[]): number {
  return rows.reduce((sum, row) => sum + row.quantityOnHand, 0);
}

export function totalPendingInbound(rows: readonly InventoryBalanceData[]): number {
  return rows.reduce((sum, row) => sum + row.pendingInboundQuantity, 0);
}

export type StockTone = 'ok' | 'warn' | 'empty';

/** 0 件用灰色，避免被读成"有货"。 */
export function stockTone(quantity: number): StockTone {
  if (quantity <= 0) return 'empty';
  if (quantity < 5) return 'warn';
  return 'ok';
}

export const movementTypeNames: Record<string, string> = {
  RECEIPT: '验收入库',
  OUTBOUND: '出库发货',
  ADJUSTMENT: '库存调整',
};

export function movementLabel(type: string): string {
  return movementTypeNames[type] ?? type;
}

/** 数量变动的展示串：出库带负号，入库带正号。 */
export function movementDeltaLabel(movement: Pick<InventoryMovementData, 'quantityDelta'>): string {
  return movement.quantityDelta > 0 ? '+' + movement.quantityDelta : String(movement.quantityDelta);
}

/** 没扫到时给一句能指导下一步的话，而不是干巴巴的"无数据"。 */
export function describeMiss(input: {
  query: string;
  byScan: boolean;
  warehouseName?: string;
}): string {
  const where = input.warehouseName ? '在「' + input.warehouseName + '」' : '';
  return input.byScan
    ? '没有找到条码为 ' +
        input.query +
        ' 的商品' +
        where +
        '。如果这个商品没有登记条码，请改用手动搜索 SKU。'
    : '没有找到与「' + input.query + '」匹配的商品' + where + '，换个关键词试试。';
}
