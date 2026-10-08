import { reactive } from "vue";
import { createRuleOwnerScope } from "./rule-owner-scope";
import { session } from "./rule-protocol.test-support";

let workspace, scope;
beforeEach(() => {
  workspace = reactive({ session: session(), enabled: true, error: "", can() { return this.enabled; } });
  scope = createRuleOwnerScope(workspace);
});
afterEach(() => scope.dispose());

test("tickets and pending counts are owned, abortable and released once", () => {
  const first = scope.begin(), second = scope.begin();
  expect(first.owner).toBe("protocol-A"); expect(scope.pendingTasks.value).toBe(2);
  scope.cancel(first); scope.finish(first);
  expect(first.signal.aborted).toBe(true); expect(scope.active(first)).toBe(false);
  expect(scope.pendingTasks.value).toBe(1);
  scope.finish(second); scope.finish(second);
  expect(scope.pendingTasks.value).toBe(0);
});

test("authority replacement aborts A synchronously and late cleanup cannot release B", () => {
  const old = scope.begin(), epoch = scope.ownerEpoch.value;
  workspace.session = session("protocol-B");
  expect(old.signal.aborted).toBe(true); expect(scope.active(old)).toBe(false);
  expect(scope.ownerKey.value).toBe("protocol-B"); expect(scope.ownerEpoch.value).toBe(epoch + 1);
  const current = scope.begin(); scope.finish(old);
  expect(scope.pendingTasks.value).toBe(1); expect(scope.active(current)).toBe(true);
});

test.each(["enabled", "error"])("same-owner %s suspension retains draft ownership, never revives tickets", (field) => {
  const old = scope.begin(), epoch = scope.ownerEpoch.value;
  workspace[field] = field === "enabled" ? false : "unverified";
  expect(scope.ownerKey.value).toBe("protocol-A"); expect(scope.ownerEpoch.value).toBe(epoch);
  expect(scope.allowed.value).toBe(false); expect(scope.begin()).toBeNull();
  expect(old.signal.aborted).toBe(true);
  workspace[field] = field === "enabled" ? true : "";
  expect(scope.active(old)).toBe(false); expect(scope.active(scope.begin())).toBe(true);
});

test("an identical verified session poll preserves the current operation", () => {
  const ticket = scope.begin(), revision = scope.revision.value;
  workspace.session = { ...workspace.session };
  expect(scope.revision.value).toBe(revision); expect(scope.active(ticket)).toBe(true);
});

test("loss of identity or workspace access clears retained draft ownership", () => {
  workspace.enabled = false; workspace.session = null;
  expect(scope.ownerKey.value).toBe("");
  workspace.enabled = true; workspace.session = session();
  workspace.session.workspace_access = false;
  expect(scope.ownerKey.value).toBe(""); expect(scope.begin()).toBeNull();
});

test("a role change invalidates tickets without moving drafts to another owner", () => {
  const ticket = scope.begin(), epoch = scope.ownerEpoch.value;
  workspace.session.administrator = true;
  expect(scope.active(ticket)).toBe(false); expect(ticket.signal.aborted).toBe(true);
  expect(scope.ownerEpoch.value).toBe(epoch);
});

test("disposal aborts all work and prevents further dispatch tickets", () => {
  const ticket = scope.begin(); scope.dispose();
  expect(ticket.signal.aborted).toBe(true); expect(scope.begin()).toBeNull();
  expect(scope.pendingTasks.value).toBe(0); expect(scope.active(ticket)).toBe(false);
});
