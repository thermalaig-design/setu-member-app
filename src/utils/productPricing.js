// Single source of truth for the price shown to users on product surfaces.
// Shows the all-inclusive amount (price after discount + GST + transport/other charges),
// i.e. what the member actually pays per unit.

const toNumber = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export const formatInr = (value) =>
  `₹${toNumber(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const getDisplayPricing = (price) => {
  if (!price || typeof price !== 'object') return null;

  const mrp = toNumber(price.mrp ?? price.price ?? price.amount);
  const base = toNumber(price.price_after_discount)
    || toNumber(price.member_price)
    || toNumber(price.selling_price)
    || toNumber(price.total_payable)
    || mrp;
  if (!(base > 0)) return null;

  const extras = Math.max(0, toNumber(price.gst_amount)) + Math.max(0, toNumber(price.transport_fee));
  const total = round2(Math.max(toNumber(price.total_payable), base + extras));
  const addOn = round2(Math.max(0, total - base));
  const discountPct = toNumber(price.discount_pct ?? price.discount_percent);
  const hasDiscount = discountPct > 0 && mrp > base;

  return {
    base,
    total,
    addOn,
    discountPct,
    hasDiscount,
    // MRP carries the same taxes/charges so "strike-through vs. pay" stays comparable.
    mrpTotal: hasDiscount ? round2(mrp + addOn) : null,
    saving: hasDiscount ? round2(mrp - base) : 0,
  };
};

export const getDisplayTotal = (price) => getDisplayPricing(price)?.total ?? null;
