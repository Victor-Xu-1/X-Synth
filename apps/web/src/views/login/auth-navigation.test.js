import { safeAccountRedirect } from "./auth-navigation";
test.each([
  ["/results", "/results"],
  ["%2Fforward%3Ftab%3Dforward", "/forward?tab=forward"],
  ["/drawing?smiles=CCO", "/drawing?smiles=CCO"],
  ["https://example.com", "/"],
  ["//example.com", "/"],
  ["/\\example.com", "/"],
  ["/login", "/"],
  ["/sso-callback?redirect=/results", "/"],
  ["/admin-login/", "/"],
  ["/x/../sso-login", "/"],
  ["%E0%A4%A", "/"],
  [null, "/"],
  [["/results"], "/"],
])("restricts account redirect %p to %p", (input, expected) => {
  expect(safeAccountRedirect(input)).toBe(expected);
});
test("retains a separately validated fallback destination", () => {
  expect(safeAccountRedirect(undefined, safeAccountRedirect("/results"))).toBe(
    "/results",
  );
});
