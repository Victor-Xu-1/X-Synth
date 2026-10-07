import { copyToClipboard } from "./utils";

afterEach(() => { delete navigator.clipboard; delete document.execCommand; document.body.innerHTML = ""; });
test("modern clipboard writes preserve the exact value and wait for success", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: jest.fn().mockResolvedValue(undefined) } });
  expect(await copyToClipboard(" [13CH3][C@H](O)F ", document.body)).toBe(true);
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(" [13CH3][C@H](O)F ");
});
test("denied clipboard permission does not trigger a legacy bypass", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) } });
  document.execCommand = jest.fn();
  expect(await copyToClipboard("CCO", document.body)).toBe(false);
  expect(document.execCommand).not.toHaveBeenCalled();
});
test.each([true, false])("legacy clipboard returns the actual result %s and restores focus", async success => {
  const opener = document.createElement("button");
  document.body.append(opener); opener.focus();
  document.execCommand = jest.fn().mockReturnValue(success);
  expect(await copyToClipboard("N", document.body)).toBe(success);
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
test("empty values do not alter the clipboard", async () => {
  document.execCommand = jest.fn();
  expect(await copyToClipboard("", document.body)).toBe(false);
  expect(document.execCommand).not.toHaveBeenCalled();
});
