import Papa from "papaparse";
import { materialsCsv } from "./route-reading";
import { setLocale } from "@/i18n";

test("material CSV separates whole-route review from each material's defined purchase form", () => {
  setLocale("zh-CN", { persist: false });
  const rows = [{ label: "User material", smiles: "CC", usedIn: ["User step"] },
    { label: "Unresolved form", smiles: "O=C([O-])[O-]", usedIn: ["User step"] }];
  const receipt = { version: 1, phase: "automated_review", basis: "route_receipt",
    grade: "purchase_form_unresolved", independent_review: { status: "missing" },
    purchase_identity: { policy: "defined_purchase_identity_v1", status: "unresolved",
      unresolved_materials: [{ smiles: rows[1].smiles, reason: "undefined_purchase_form" }] } };
  const before = JSON.stringify({ rows, receipt });
  const data = Papa.parse(materialsCsv(rows, receipt)).data;
  expect(data[0]).toEqual(["原料", "结构 SMILES", "使用步骤", "路线核验等级", "采购形式", "采购形式原因"]);
  expect(data[1]).toEqual(["User material", "CC", "User step", "采购形式未明确", "采购形式明确", ""]);
  expect(data[2]).toEqual(["Unresolved form", "O=C([O-])[O-]", "User step", "采购形式未明确", "采购形式未明确", "完整采购形式未记录"]);
  expect(JSON.stringify({ rows, receipt })).toBe(before);
});
