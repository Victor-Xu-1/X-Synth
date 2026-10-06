import { elapsedLabel, searchProgressRows } from "./task-progress";

test("elapsed time is reported from measured search data, never guessed", () => {
  expect(elapsedLabel(1804.789781332016)).toBe("30 分 4 秒");
  expect(elapsedLabel(41.367290019989014)).toBe("41 秒");
  expect(elapsedLabel(0)).toBe("0 秒");
  for (const value of [undefined, null, -1, NaN, Infinity]) {
    expect(elapsedLabel(value)).toBe("未记录");
  }
});

test("progress labels preserve unknown values and both strategy counters", () => {
  const rows = searchProgressRows({ native_progress: {
    mcts: { iterations: 11, chemicals: 694, elapsed_seconds: 40.9086022377 },
    retro_star: { iterations: 15, chemicals: 441, elapsed_seconds: 41.36729002 },
  } });
  expect(rows.map((row) => row.label)).toEqual(["树搜索", "启发式搜索"]);
  expect(rows.map((row) => row.iterations)).toEqual([11, 15]);
  expect(searchProgressRows({ native_progress: { mcts: {} } })[0].chemicals).toBeNull();
  expect(searchProgressRows(null)).toEqual([]);
});
