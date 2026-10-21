import { Prisma } from '../../generated/prisma/client.js';
import { BusinessException } from '../../common/errors.js';

// Local precision avoids changing Prisma's global Decimal settings or rounding large intermediates.
const Decimal = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });
const maxMoney = new Decimal('9999999999999999.99');
export interface CostLine {
  quantity: number;
  unitPrice: string | Prisma.Decimal;
  discountAmount: string | Prisma.Decimal;
}
export function purchaseCost(lines: readonly CostLine[], freight: string | Prisma.Decimal) {
  if (!lines.length || lines.length > 100)
    throw new BusinessException('BUSINESS_VALIDATION_FAILED');
  const freightAmount = new Decimal(freight);
  if (!freightAmount.isFinite() || freightAmount.isNegative() || freightAmount.gt(maxMoney))
    throw new BusinessException('BUSINESS_VALIDATION_FAILED');
  let goodsAmount = new Decimal(0),
    discountAmount = new Decimal(0),
    pieces = new Decimal(0);
  const nets = lines.map((line) => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 2147483647)
      throw new BusinessException('BUSINESS_VALIDATION_FAILED');
    const unit = new Decimal(line.unitPrice),
      discount = new Decimal(line.discountAmount);
    if (!unit.isFinite() || unit.isNegative() || !discount.isFinite() || discount.isNegative())
      throw new BusinessException('BUSINESS_VALIDATION_FAILED');
    const gross = unit.mul(line.quantity),
      net = gross.minus(discount);
    if (net.isNegative()) throw new BusinessException('BUSINESS_VALIDATION_FAILED');
    goodsAmount = goodsAmount.plus(gross);
    discountAmount = discountAmount.plus(discount);
    pieces = pieces.plus(line.quantity);
    return net;
  });
  const netTotal = goodsAmount.minus(discountAmount),
    totalCost = netTotal.plus(freightAmount);
  // Summary amounts must remain representable at the project's NUMERIC(18,2) boundary.
  if (goodsAmount.gt(maxMoney) || discountAmount.gt(maxMoney) || totalCost.gt(maxMoney))
    throw new BusinessException('BUSINESS_VALIDATION_FAILED');
  let remaining = freightAmount;
  const items = lines.map((line, index) => {
    const weight = netTotal.isZero() ? new Decimal(line.quantity) : nets[index]!;
    const denominator = netTotal.isZero() ? pieces : netTotal;
    // Earlier rows truncate to cents; the last row absorbs the remainder, never negative.
    const allocation =
      index === lines.length - 1
        ? remaining
        : freightAmount.mul(weight).div(denominator).toDecimalPlaces(2, Decimal.ROUND_DOWN);
    remaining = remaining.minus(allocation);
    return {
      lineNet: nets[index]!.toFixed(2),
      freightAllocated: allocation.toFixed(2),
      landedUnitCost: nets[index]!.plus(allocation).div(line.quantity).toFixed(4),
    };
  });
  return {
    goodsAmount: goodsAmount.toFixed(2),
    discountAmount: discountAmount.toFixed(2),
    totalCost: totalCost.toFixed(2),
    items,
  };
}
