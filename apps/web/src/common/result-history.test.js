import { loadResultHistory } from "./result-history";

test("loads every owned history page from one authoritative endpoint", async () => {
  const calls = [];
  const api = { get: async (path, query) => {
    calls.push({ path, query });
    return Array.from({ length: query.offset === 0 ? 100 : 34 }, (_, i) => ({ result_id: query.offset + i }));
  } };
  const results = await loadResultHistory(api);
  expect(results).toHaveLength(134);
  expect(calls).toEqual([
    { path: "/api/results/list", query: { limit: 100, offset: 0 } },
    { path: "/api/results/list", query: { limit: 100, offset: 100 } },
  ]);
});
