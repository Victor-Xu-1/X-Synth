import {
  chemicalFileBody,
  chemicalRecords,
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
])(
  "rejects malformed responses rather than applying a partial first entry",
  (value) => {
    expect(() => chemicalRecords(value)).toThrow();
  },
);
