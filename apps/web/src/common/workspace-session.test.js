import { hasWorkspaceAccess, readWorkspaceAccess } from "./workspace-session";

test("local workspace access comes from the real server contract", async () => {
  const request = jest.fn(async () => ({ ok: true, json: async () => ({ mode: "local", workspace_access: true }) }));
  expect(await hasWorkspaceAccess(request)).toBe(true);
  expect(request.mock.calls[0][0]).toBe("/api/v1/session");
});

test("shared identity, invalid output, and failed requests never bypass login", async () => {
  expect(await hasWorkspaceAccess(async () => ({ ok: false }))).toBe(false);
  expect(await hasWorkspaceAccess(async () => ({ ok: true, json: async () => ({ mode: "askcos", workspace_access: true }) }))).toBe(false);
  expect(await hasWorkspaceAccess(async () => { throw new Error("offline"); })).toBe(false);
});

test.each([
  [200, { mode: "local", workspace_access: true }, "allowed"],
  [200, { mode: "local", workspace_access: false }, "denied"],
  [200, { mode: "askcos", workspace_access: true }, "denied"],
  [401, null, "denied"], [403, null, "denied"],
  [503, null, "unavailable"], [500, null, "unavailable"],
  [200, { mode: "local", workspace_access: "true" }, "unavailable"],
  [200, { mode: "unknown", workspace_access: true }, "unavailable"],
])("a fresh access response %s/%j is classified as %s without cached authority", async (status, body, expected) => {
  const fetcher = jest.fn(async () => ({ status, ok: status === 200, json: async () => body }));
  expect(await readWorkspaceAccess({ fetcher })).toBe(expected);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("network and invalid JSON are unavailable, not a confirmed denial", async () => {
  expect(await readWorkspaceAccess({ fetcher: async () => { throw new Error("offline"); } })).toBe("unavailable");
  expect(await readWorkspaceAccess({ fetcher: async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("invalid"); } }) })).toBe("unavailable");
});

test("the owning navigation can cancel its access read and late body cannot grant it", async () => {
  let finish;
  const owner = new AbortController();
  const fetcher = jest.fn((_url, options) => new Promise(resolve => { finish = resolve; owner.observed = options.signal; }));
  const read = readWorkspaceAccess({ fetcher, signal: owner.signal });
  owner.abort(); expect(owner.observed.aborted).toBe(true);
  finish({ status: 200, ok: true, json: async () => ({ mode: "local", workspace_access: true }) });
  expect(await read).toBe("unavailable");
});

test("a pre-cancelled read cannot issue work and a body read that finishes after cancellation cannot authorize", async () => {
  const owner = new AbortController(), fetcher = jest.fn(); owner.abort();
  expect(await readWorkspaceAccess({ fetcher, signal: owner.signal })).toBe("unavailable");
  expect(fetcher).not.toHaveBeenCalled();
  const bodyOwner = new AbortController(); let finish;
  const response = { status: 200, ok: true, json: () => new Promise(resolve => { finish = resolve; }) };
  const run = readWorkspaceAccess({ fetcher: async () => response, signal: bodyOwner.signal });
  await Promise.resolve(); bodyOwner.abort(); finish({ mode: "local", workspace_access: true });
  expect(await run).toBe("unavailable");
});
