import { createWorkspaceNavigationAccess } from "./workspace-navigation-access";

const from = { fullPath: "/buyables?smiles=CCO" };
const to = { fullPath: "/references", meta: { workspace: true } };
const setup = probe => {
  const workspace = { navigationFailure: null };
  return { workspace, ...createWorkspaceNavigationAccess({ getWorkspace: () => workspace, probe }) };
};

test("unavailable navigation is aborted with a recoverable target; actual denial still requires login", async () => {
  const probe = jest.fn().mockResolvedValueOnce("unavailable").mockResolvedValueOnce("denied").mockResolvedValueOnce("allowed");
  const state = setup(probe);
  expect(await state.check(to, from, state.begin(to, from))).toBe(false);
  expect(state.workspace.navigationFailure).toEqual({ from: from.fullPath, target: to.fullPath });
  expect(await state.check(to, from, state.begin(to, from))).toEqual({ name: "登录", query: { redirect: to.fullPath } });
  expect(state.workspace.navigationFailure).toBeNull();
  expect(await state.check(to, from, state.begin(to, from))).toBeUndefined();
  expect(probe).toHaveBeenCalledTimes(3);
});

test("superseding navigation retires the old read without publishing old denial or failure", async () => {
  const pending = [], probe = jest.fn(options => new Promise(resolve => pending.push({ options, resolve })));
  const state = setup(probe), older = state.check(to, from, state.begin(to, from));
  const next = { fullPath: "/process" }, newer = state.check(next, from, state.begin(next, from));
  expect(pending[0].options.signal.aborted).toBe(true);
  pending[1].resolve("allowed"); expect(await newer).toBeUndefined();
  pending[0].resolve("denied"); expect(await older).toBe(false);
  expect(state.workspace.navigationFailure).toBeNull();
});

test("unavailable initial entry retains the intended URL and does not fabricate a login route", async () => {
  const state = setup(jest.fn().mockResolvedValue("unavailable"));
  const initial = { fullPath: "/", matched: [] };
  expect(await state.check(to, initial, state.begin(to, initial))).toBe(false);
  expect(state.workspace.navigationFailure).toEqual({ from: "/", target: "/references" });
});

test.each(["//external.example", "/bad\\path", "/bad\npath"])("unsafe recovery destinations are not retained: %p", async target => {
  const state = setup(jest.fn().mockResolvedValue("unavailable")), unsafe = { fullPath: target };
  expect(await state.check(unsafe, from, state.begin(unsafe, from))).toBe(false);
  expect(state.workspace.navigationFailure.target).toBeNull();
});

test("a new page intent clears an old notice and a failed retry never pretends to commit", async () => {
  const state = setup(jest.fn().mockResolvedValue("unavailable"));
  await state.check(to, from, state.begin(to, from));
  const original = state.workspace.navigationFailure;
  const same = state.begin(to, from); expect(state.workspace.navigationFailure).toBe(original);
  await state.check(to, from, same); state.committed(to, from, { type: 4 });
  expect(state.workspace.navigationFailure).not.toBeNull();
  state.begin({ fullPath: "/process" }, from); expect(state.workspace.navigationFailure).toBeNull();
});
