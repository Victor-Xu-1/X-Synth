import { knownPrice, routePrecursorPrices } from "./route-price";

test("commercial closure never invents a purchase price", () => {
  expect(knownPrice(undefined)).toBeNull();
  expect(knownPrice({ppg: null})).toBeNull();
  expect(knownPrice({ppg: 0})).toBeNull();
  expect(knownPrice({ppg: 2.08})).toBe(2.08);
  const prices = routePrecursorPrices({steps:[{metadata:{precursor_properties:{precursor_prices:{CCO:{ppg:5.16}}}}}]});
  expect(knownPrice(prices.CCO)).toBe(5.16);
});
