import { newerWorkspaceVersion } from "./workspace-version";

test.each([
  ["0.1.5", "0.1.6", "0.1.6"],
  ["0.1.99", "0.2.0", "0.2.0"],
  ["0.9.99", "1.0.0", "1.0.0"],
  ["0.1.5", "0.1.5", null],
  ["0.2.0", "0.1.99", null],
  ["1.0.0", "0.9.99", null],
  ["0.1.5", null, null],
  ["0.1.5", {}, null],
  ["0.1.5", "0.10.0", null],
  ["0.1.5", "0.1.100", null],
  ["0.1.5", "0.2.0-beta", null],
  ["0.1.5", "v0.2.0", null],
  ["0.1.5", "0.02.0", null],
  ["0.1.5", "0.2.0\n", null],
  ["invalid", "0.2.0", null],
])("compares loaded %p with real API %p without guessing a release", (loaded, running, expected) => {
  expect(newerWorkspaceVersion(loaded, running)).toBe(expected);
});
