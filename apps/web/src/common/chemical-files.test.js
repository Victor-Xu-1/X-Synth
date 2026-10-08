import {
  chemicalFileBody,
  chemicalRecords,
  chemicalStructureIdentity,
  downloadChemicalFile,
  maxChemicalFileBytes,
} from "./chemical-files";
import { TextDecoder, TextEncoder } from "util";

beforeAll(() => {
  global.TextDecoder = TextDecoder;
});
function file(name, text) {
  const data = new TextEncoder().encode(text);
  return { name, size: data.length, arrayBuffer: async () => data.buffer };
}

test.each([
  ["compound.MOL", "mol"],
  ["compounds.sdf", "sdf"],
  ["compounds.sd", "sdf"],
  ["compounds.smiles", "smi"],
])("uses explicit chemical file formats: %s", async (name, format) => {
  expect(await chemicalFileBody(file(name, "CCO"))).toEqual({
    format,
    content: "CCO",
  });
});
test("rejects unsupported, empty, oversized and non-UTF-8 files before an API call", async () => {
  await expect(chemicalFileBody(file("structure.cdx", "CDX"))).rejects.toThrow(
    "MOL",
  );
  await expect(chemicalFileBody(file("structure.mol", ""))).rejects.toThrow(
    "不能为空",
  );
  await expect(
    chemicalFileBody({ name: "structure.sdf", size: maxChemicalFileBytes + 1 }),
  ).rejects.toThrow("2 MiB");
  await expect(
    chemicalFileBody({
      name: "structure.mol",
      size: 1,
      arrayBuffer: async () => Uint8Array.of(0xff).buffer,
    }),
  ).rejects.toThrow("UTF-8");
});

const record = {
  index: 1,
  name: "Compound",
  smiles: "CCO",
  atoms: 3,
  components: 1,
  formula: "C2H6O",
  molecular_weight: 46.069,
};
test("retains every record and all disconnected components for explicit selection", () => {
  const records = [
    record,
    { ...record, index: 2, smiles: "[Na+].CC(=O)[O-]", components: 2 },
  ];
  expect(chemicalRecords({ format: "sdf", records })).toBe(records);
});
test.each([
  {},
  { format: "sdf", records: [] },
  { format: "sdf", records: [{ ...record, smiles: "" }] },
  { format: "sdf", records: [{ ...record, index: 2 }] },
  { format: "toString", records: [record] },
  { format: "sdf", records: [{ ...record, formula: "" }] },
  { format: "sdf", records: [{ ...record, components: 4 }] },
  { format: "sdf", records: [{ ...record, molecular_weight: -1 }] },
  { format: "sdf", records: [{ ...record, name: "line\nbreak" }] },
])(
  "rejects malformed responses rather than applying a partial first entry",
  (value) => {
    expect(() => chemicalRecords(value)).toThrow();
  },
);

test("an import response must retain the requested format", () => {
  expect(() => chemicalRecords({ format: "sdf", records: [record] }, "mol"))
    .toThrow("响应无效");
});

test("valid UTF-8 read failures are not misreported as encoding failures", async () => {
  await expect(chemicalFileBody({ name: "sample.mol", size: 1,
    arrayBuffer: async () => { throw new Error("unreadable host file"); } }))
    .rejects.not.toThrow("UTF-8");
});

test.each(["  \r\n\t", ""])("rejects empty decoded content (%j)", async (content) => {
  await expect(chemicalFileBody({ ...file("sample.smi", content), size: 8 }))
    .rejects.toThrow("不能为空");
});

test("cancellation settles a pending file read without awaiting its result", async () => {
  const controller = new AbortController();
  const task = chemicalFileBody({ name: "sample.smi", size: 1,
    arrayBuffer: () => new Promise(() => {}) }, { signal: controller.signal });
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: "AbortError" });
});

test("a stalled host read has a bounded deadline and releases its timer", async () => {
  jest.useFakeTimers();
  try {
    const task = chemicalFileBody({ name: "sample.smi", size: 1,
      arrayBuffer: () => new Promise(() => {}) }, { timeoutMs: 100 });
    const result = expect(task).rejects.toThrow("解析失败");
    jest.advanceTimersByTime(100);
    await result;
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});

test("record validation preserves the original strings without chemistry normalization", () => {
  const named = { ...record, name: "取消-样品 β", smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]", components: 2, atoms: 6 };
  expect(chemicalRecords({ format: "smi", records: [named] })[0]).toBe(named);
});

test.each([{}, { valid: false, smiles: "CCO", atoms: 3 }, { valid: true, smiles: "", atoms: 3 },
  { valid: true, smiles: "CCO", atoms: 0 }])("export identity requires a complete validation result (%j)", value => {
  expect(() => chemicalStructureIdentity(value)).toThrow("结构无效");
});

test.each(["__proto__", "constructor", "toString", "pdf", "eln", "cdxml"])("never guesses an unsupported extension (%s)", async (extension) => {
  await expect(chemicalFileBody(file(`sample.${extension}`, "CCO"))).rejects.toThrow("MOL");
});

describe("chemical downloads", () => {
  let click, originalCreate, originalRevoke;
  beforeEach(() => {
    jest.useFakeTimers();
    originalCreate = URL.createObjectURL;
    originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:chemical");
    URL.revokeObjectURL = jest.fn();
    click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    click.mockRestore();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
  test("retains raw Unicode names and the chosen format", () => {
    downloadChemicalFile({ format: "mol", content: "real API content" }, "取消-样品 β.sdf", "mol");
    expect(click.mock.instances[0].download).toBe("取消-样品 β.mol");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:chemical");
  });
  test("rejects a response for another format before creating a download", () => {
    expect(() => downloadChemicalFile({ format: "smi", content: "CCO" }, "sample", "mol"))
      .toThrow("响应无效");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  test("enforces the UTF-8 byte limit, not the JavaScript string length", () => {
    expect(() => downloadChemicalFile({ format: "smi", content: "中".repeat(maxChemicalFileBytes / 2) }))
      .toThrow("响应无效");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  test("revokes the URL even if the browser refuses the download", () => {
    click.mockImplementation(() => { throw new Error("download refused"); });
    expect(() => downloadChemicalFile({ format: "rxn", content: "$RXN" }, "reaction")).toThrow();
    jest.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:chemical");
  });
});
