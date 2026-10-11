import evidence from "./catalog-routes-evidence";
import reader from "./catalog-routes-reader";
import { buildCatalog } from "./catalog";
import { DEFAULT_LOCALE, initializeLocale, setLocale, uiText } from "./index";

const additions = [
  ["采购依据无效", "Procurement evidence invalid"],
  ["不能作为已确认商购原料", "Not a confirmed commercial starting material"],
  ["目录记录不代表实时供货、纯度或实验可用性。", "Catalogue records do not establish live supply, purity or experimental usability."],
];

test("source-only yield qualifier follows UI language without changing raw reported text", () => {
  const key = "原文记录，未作数值解析";
  initializeLocale(null);
  expect(uiText(key)).toBe("Reported text; not numerically interpreted");
  expect(uiText("70-80%\r\nsource prose")).toBe("70-80%\r\nsource prose");
  setLocale("zh-CN", { persist: false });
  expect(uiText(key)).toBe(key);
});

test("procurement additions belong to the existing evidence catalog and reuse the existing form labels", () => {
  const messages = buildCatalog([reader, evidence]);
  for (const pair of additions) {
    expect(evidence).toContainEqual(pair);
    expect(messages.en[pair[0]]).toBe(pair[1]);
  }
  for (const label of ["采购形式明确", "采购形式未明确", "采购形式未核验", "完整采购形式未记录", "采购结构无法确定"])
    expect(messages.en[label]).not.toBe(label);
});

test("all record procurement labels switch from the shared English default without translating scientific data", () => {
  expect(DEFAULT_LOCALE).toBe("en");
  initializeLocale(null);
  const labels = [...additions, ["采购形式明确", "Purchase form defined"], ["采购形式未明确", "Purchase form unresolved"],
    ["采购形式未核验", "Purchase form unreviewed"], ["完整采购形式未记录", "Complete purchase form not recorded"],
    ["采购结构无法确定", "Purchase structure indeterminate"]];
  for (const [source, english] of labels) expect(uiText(source)).toBe(english);
  const raw = ["O=C([O-])[O-]", "3812-32-6", "supplier原始记录", "2.08 $/g"];
  for (const value of raw) expect(uiText(value)).toBe(value);
  setLocale("zh-CN", { persist: false });
  for (const [source] of labels) expect(uiText(source)).toBe(source);
  for (const value of raw) expect(uiText(value)).toBe(value);
});
