import { KETCHER_URL, createKetcherWriter, replaceKetcherMolecule, waitForKetcher } from "./ketcher";

test("Ketcher URL resolves to the bundled standalone editor", () => {
  const fs = require("fs");
  const path = require("path");
  expect(fs.existsSync(path.resolve(__dirname, "../../public", KETCHER_URL.slice(1)))).toBe(true);
});

test("readiness follows the installed editor API rather than a legacy ready flag", async () => {
  const ketcher = { editor: {}, setMolecule: jest.fn(), getSmiles: jest.fn() };
  expect(await waitForKetcher(() => ({ contentWindow: { ketcher } }))).toBe(ketcher);
});

test("readiness stops when its owner is unmounted", async () => {
  const controller = new AbortController();
  const result = waitForKetcher(() => null, { signal: controller.signal });
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
});

test("unavailable editor has a bounded wait", async () => {
  await expect(waitForKetcher(() => null, { timeoutMs: 0 })).rejects.toThrow("did not become ready");
});

test("replacement awaits import and uses the editor clear API for empty structures", async () => {
  const ketcher = { setMolecule: jest.fn().mockResolvedValue(undefined), editor: { clear: jest.fn() } };
  await replaceKetcherMolecule(ketcher, "CCO");
  expect(ketcher.setMolecule).toHaveBeenCalledWith("CCO");
  await replaceKetcherMolecule(ketcher, "");
  expect(ketcher.editor.clear).toHaveBeenCalledTimes(1);
});

test("queued updates coalesce to the latest structure and recover after invalid input", async () => {
  const ketcher = { setMolecule: jest.fn().mockResolvedValue(undefined), editor: { clear: jest.fn() } };
  const write = createKetcherWriter(async () => ketcher);
  const first = write("CCO");
  const latest = write("CCC");
  expect(await first).toBe(false);
  expect(await latest).toBe(true);
  expect(await write.flush()).toBe(true);
  expect(ketcher.setMolecule).toHaveBeenCalledTimes(1);
  expect(ketcher.setMolecule).toHaveBeenCalledWith("CCC");
  ketcher.setMolecule.mockRejectedValueOnce(new Error("Invalid molecule"));
  await expect(write("invalid")).rejects.toThrow("Invalid molecule");
  await expect(write.flush()).rejects.toThrow("Invalid molecule");
  expect(await write("CCN")).toBe(true);
});
