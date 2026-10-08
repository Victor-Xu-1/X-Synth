import { canEditAccount, canMutateAccounts, nativeAccountAuthority } from "./account-access";
const authority = (administrator = false) => ({ owner: "researcher", administrator, key: "protocol" });
test.each(["email", "password"])("ordinary identities can %s only their own permanent account", (mode) => {
  expect(canEditAccount(authority(), false, mode, "researcher")).toBe(true);
  expect(canEditAccount(authority(), false, mode, "another")).toBe(false);
  expect(canEditAccount(authority(true), true, mode, "guest_protocol")).toBe(false);
});
test.each(["admin", "normal", "enable", "disable"])("%s requires both loaded admin permission and current server admin authority", (action) => {
  expect(canMutateAccounts(authority(), true, ["another"], action)).toBe(false);
  expect(canMutateAccounts(authority(true), false, ["another"], action)).toBe(false);
  expect(canMutateAccounts(authority(true), true, ["another"], action)).toBe(true);
});
test("self deletion remains supported, and unknown or duplicate targets/actions fail closed", () => {
  expect(canMutateAccounts(authority(), false, ["researcher"], "delete")).toBe(true);
  expect(canMutateAccounts(authority(), false, ["another"], "delete")).toBe(false);
  expect(canMutateAccounts(authority(true), true, ["another", "another"], "delete")).toBe(false);
  expect(canMutateAccounts(authority(true), true, ["another"], "unknown")).toBe(false);
  expect(canEditAccount(authority(), false, "new")).toBe(false);
});
test("local administrator flags, guest roles, lost capability and session errors never grant native account access", () => {
  const workspace = { session: { mode: "local", owner: "local_workspace", administrator: true, workspace_access: true }, error: "", can: () => true };
  expect(nativeAccountAuthority(workspace)).toBeNull();
  workspace.session = { ...workspace.session, mode: "askcos", owner: "guest_protocol" };
  expect(nativeAccountAuthority(workspace)).toBeNull();
  workspace.session.owner = "researcher"; workspace.error = "unverified";
  expect(nativeAccountAuthority(workspace)).toBeNull();
  workspace.error = ""; workspace.can = () => false;
  expect(nativeAccountAuthority(workspace)).toBeNull();
});
