import { createKetcherReadQueue } from "./ketcher-reads";

test("superseded native exports release busy ownership without blocking a new reader", async () => {
  const queue = createKetcherReadQueue();
  let finishOld, finishNew, oldCurrent;
  const old = queue.enqueue(current => {
    oldCurrent = current;
    return new Promise(resolve => { finishOld = resolve; });
  });
  await Promise.resolve();
  expect(queue.pending.value).toBe(1);
  queue.invalidate();
  expect(queue.pending.value).toBe(0);
  expect(oldCurrent()).toBe(false);
  const fresh = queue.enqueue(() => new Promise(resolve => { finishNew = resolve; }));
  await Promise.resolve();
  expect(queue.pending.value).toBe(1);
  finishOld("obsolete"); await old;
  expect(queue.pending.value).toBe(1);
  finishNew("fresh");
  expect(await fresh).toBe("fresh");
  expect(queue.pending.value).toBe(0);
});

test("obsolete queued reads never start and current failures release their owner", async () => {
  const queue = createKetcherReadQueue();
  const read = jest.fn();
  const old = queue.enqueue(read);
  queue.invalidate();
  expect(await old).toBeNull();
  expect(read).not.toHaveBeenCalled();
  await expect(queue.enqueue(() => { throw new Error("export failed"); })).rejects.toThrow("export failed");
  expect(queue.pending.value).toBe(0);
  expect(await queue.enqueue(async () => "current")).toBe("current");
});

test("retiring an in-flight reader settles its caller without awaiting the native export", async () => {
  const queue = createKetcherReadQueue();
  let finish, outcome = "pending";
  const result = queue.enqueue(() => new Promise(resolve => { finish = resolve; }));
  result.then(value => { outcome = value; });
  await Promise.resolve();
  queue.invalidate();
  await new Promise(resolve => setTimeout(resolve, 0));
  try { expect(outcome).toBeNull(); }
  finally { finish("late native output"); await result; }
});
