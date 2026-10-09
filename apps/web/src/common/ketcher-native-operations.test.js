import { runKetcherOperation } from "./ketcher-native-operations";
import { createKetcherReadQueue } from "./ketcher-reads";

test("logical retirement never overlaps uncancelled exports on the same native instance", async () => {
  const owner = {}, host = createKetcherReadQueue();
  let finish, started = 0;
  const old = host.enqueue(current => runKetcherOperation(owner, () => {
    started++;
    return new Promise(resolve => { finish = resolve; });
  }, current));
  await new Promise(resolve => setTimeout(resolve, 0));
  host.invalidate();
  expect(await old).toBeNull();
  const latest = host.enqueue(current => runKetcherOperation(owner, () => { started++; return "CCN"; }, current));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(started).toBe(1);
  finish("CCO");
  expect(await latest).toBe("CCN");
  expect(started).toBe(2);
});

test("a fresh native instance has an independent lane and obsolete queued calls never export", async () => {
  const first = {}, next = {};
  let finish, current = true;
  const old = runKetcherOperation(first, () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  const stale = jest.fn();
  const queued = runKetcherOperation(first, stale, () => current);
  expect(await runKetcherOperation(next, async () => "fresh")).toBe("fresh");
  current = false; finish("obsolete"); await old;
  expect(await queued).toBeNull();
  expect(stale).not.toHaveBeenCalled();
});
