import { computed } from "vue";
import { buildCatalog } from "@/i18n/catalog";
import common from "@/i18n/catalog-common";
import research from "@/i18n/catalog-research";
import { DEFAULT_LOCALE, setLocale, uiText } from "@/i18n";
import { processMessage, processNotice } from "./ui-copy";
import { optimizationMessage } from "../optimization/ui-copy";
import { qmFieldCaption } from "../qm/qm-ui";
import { solubilityContextText, solubilityFieldCaption } from "../solprop/ui-copy";
import { impurityModeLabel, impurityNotice } from "../impurity/ui-copy";

test("owned full-phrase catalogs match the read-only common glossary and compile in both actual locales", () => {
  expect(DEFAULT_LOCALE).toBe("en"); expect(() => buildCatalog([common, research])).not.toThrow();
  for (const locale of ["en", "zh-CN"]) {
    setLocale(locale, { persist: false });
    for (const [source] of research) {
      const values = Object.fromEntries([...source.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], "0"]));
      expect(uiText(source, values)).not.toMatch(/\{\w+\}/);
    }
  }
});

test("complete interpolation preserves user column text, arbitrary chemical identity and zero counts", () => {
  setLocale(DEFAULT_LOCALE, { persist: false });
  const name = "研究者列名 [13CH3][C@H]([NH3+])CO.[Cl-]";
  expect(uiText("{name} 因子类型", { name })).toBe(`${name} factor type`);
  expect(uiText("{total} 条记录 · 已选择 {selected}", { total: 0, selected: 0 })).toBe("0 records · 0 selected");
  const message = optimizationMessage(`${name} 的水平重复。`);
  expect(message).toBe(`Levels for ${name} contain duplicates.`);
});

test("the owned CSV column-count error follows locale without translating unrelated source prose", () => {
  const source = "CSV 必须包含 2-24 列。";
  setLocale("en", { persist: false }); expect(optimizationMessage(source)).toBe("CSV must contain 2-24 columns.");
  expect(optimizationMessage("研究者原始表说明 [Na+] / %")).toBe("研究者原始表说明 [Na+] / %");
  setLocale("zh-CN", { persist: false }); expect(optimizationMessage(source)).toBe(source);
});

test("controlled dynamic validation and scientific notice displays are reactive, with unknown source prose unchanged", () => {
  const invalidMass = computed(() => processMessage("质量必须是有限的非负数。"));
  const zeroPmi = computed(() => processNotice("分离产物质量为零：PMI 分母为零，不返回无穷大或零 PMI。"));
  setLocale(DEFAULT_LOCALE, { persist: false });
  expect(invalidMass.value).toBe("Mass must be a finite, nonnegative number.");
  expect(zeroPmi.value).toContain("neither infinite nor zero PMI");
  expect(processNotice("溶剂 0：缺少质量。")).toBe("Solvent 0: mass is missing.");
  expect(processNotice("未知")).toBe("未知"); expect(processNotice("研究者实验原文：无色液体，尚未复测。")).toBe("研究者实验原文：无色液体，尚未复测。");
  expect(solubilityContextText("研究者来源文本")).toBe("研究者来源文本");
  setLocale("zh-CN", { persist: false });
  expect(invalidMass.value).toBe("质量必须是有限的非负数。");
  expect(zeroPmi.value).toBe("分离产物质量为零：PMI 分母为零，不返回无穷大或零 PMI。");
});

test("field captions change without translating API keys, original export headers, units or model identity", () => {
  const raw = { key: "npa_e", title: "npa charge (e)", value: 0, model: "native_model", license: "BSD-3-Clause" };
  const before = JSON.stringify(raw);
  setLocale(DEFAULT_LOCALE, { persist: false });
  expect(qmFieldCaption(raw.key, raw.title)).toBe("NPA charge (e)");
  expect(solubilityFieldCaption("st_1", "Solubility (method1) [mg/mL]")).toBe("Solubility (method1) [mg/mL]");
  setLocale("zh-CN", { persist: false });
  expect(qmFieldCaption(raw.key, raw.title)).toBe("NPA 电荷 (e)");
  expect(solubilityFieldCaption("st_1", "Solubility (method1) [mg/mL]")).toBe("溶解度（方法 1）[mg/mL]");
  expect(JSON.stringify(raw)).toBe(before);
});

test("native impurity copy requires exact controlled identity and never rewrites unknown notices or labels", () => {
  const origin = { mode: 2, mode_label: "过度反应" };
  const caption = computed(() => impurityModeLabel(origin));
  const source = "联合评分不是经校准的成功率、风险、浓度或检出概率。";
  const notice = computed(() => impurityNotice(source));
  setLocale(DEFAULT_LOCALE, { persist: false });
  expect(caption.value).toBe("Overreaction"); expect(notice.value).toContain("not a calibrated success rate");
  expect(impurityModeLabel({ mode: 2, mode_label: "研究者原文 [Na+]" })).toBe("研究者原文 [Na+]");
  expect(impurityNotice("未提供")).toBe("未提供");
  expect(impurityNotice(`${source} 研究者备注`)).toBe(`${source} 研究者备注`);
  setLocale("zh-CN", { persist: false });
  expect(caption.value).toBe(origin.mode_label); expect(notice.value).toBe(source);
});
