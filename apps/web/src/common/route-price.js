export function routePrecursorPrices(route) {
  const prices = {};
  for (const step of route.steps || []) {
    Object.assign(prices, step.metadata?.precursor_properties?.precursor_prices || {});
  }
  return prices;
}

export function knownPrice(record) {
  return Number.isFinite(record?.ppg) && record.ppg > 0 ? record.ppg : null;
}
