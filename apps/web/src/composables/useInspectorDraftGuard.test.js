import { effectScope, ref } from "vue";
import { useInspectorDraftGuard } from "./useInspectorDraftGuard";

function setup() {
  const scope = effectScope(), context = ref("a"), node = ref("n");
  const confirm = jest.fn(() => true), discard = jest.fn(() => true);
  const guard = scope.run(() => useInspectorDraftGuard({
    contextId: () => context.value, nodeId: () => node.value, confirm, discard,
  }));
  return { scope, context, node, confirm, discard, guard };
}

test("only the current document and node can publish draft state; older signals cannot erase it", () => {
  const { scope, guard, context, node } = setup();
  guard.receive({ contextId: "a", nodeId: "n", dirty: true, revision: 2 });
  guard.receive({ contextId: "a", nodeId: "n", dirty: false, revision: 1 });
  expect(guard.dirty.value).toBe(true);
  expect(guard.revision.value).toBe(2);
  context.value = "b";
  guard.receive({ contextId: "a", nodeId: "n", dirty: true, revision: 3 });
  expect(guard.dirty.value).toBe(false);
  guard.receive({ contextId: "b", nodeId: "n", dirty: true, revision: 1 });
  node.value = "other";
  expect(guard.dirty.value).toBe(false);
  scope.stop();
});

test("cancellation and refused discard retain a draft; confirmation releases it once", () => {
  const { scope, guard, confirm, discard } = setup();
  guard.receive({ contextId: "a", nodeId: "n", dirty: true, revision: 1 });
  confirm.mockReturnValue(false);
  expect(guard.requestDiscard()).toBe(false);
  expect(discard).not.toHaveBeenCalled();
  expect(guard.dirty.value).toBe(true);
  confirm.mockReturnValue(true); discard.mockReturnValue(false);
  expect(guard.requestDiscard()).toBe(false);
  expect(guard.dirty.value).toBe(true);
  discard.mockReturnValue(true);
  expect(guard.requestDiscard()).toBe(true);
  expect(guard.dirty.value).toBe(false);
  const calls = confirm.mock.calls.length;
  expect(guard.requestDiscard()).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(calls);
  scope.stop();
  expect(guard.requestDiscard()).toBe(false);
});
