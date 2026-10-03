import { hasWorkspaceAccess } from "./workspace-session";

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
