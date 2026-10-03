import { nativeResult } from "./native-response";

test("successful empty native results remain distinct from failed envelopes", () => {
  expect(nativeResult({ status_code: 200, result: [] })).toEqual([]);
  expect(nativeResult([])).toEqual([]);
  expect(nativeResult({ result: 0 })).toBe(0);
  for (const response of [
    { status_code: 500, result: [] },
    { status_code: 503, result: [] },
    { status_code: "200", result: [] },
    { status_code: 200, result: [], error: "failure" },
    null,
  ])
    expect(() => nativeResult(response)).toThrow();
});
