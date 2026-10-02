import {
  getDomesticBuyableSources,
  getBuyableSourceScope,
  sourceArgsToDisplay,
} from "@/common/buyables";

test("does not treat legacy source abbreviations as domestic suppliers", () => {
  const legacySources = ["CB", "CS", "EM", "LN", "MC", "SA"];

  expect(getDomesticBuyableSources(legacySources)).toStrictEqual([]);
  expect(getBuyableSourceScope(legacySources, true, [])).toStrictEqual({
    key: "all",
    label: "全部来源",
    sources: legacySources,
    domesticCount: 0,
    selectedCount: legacySources.length,
  });
});

test("recognizes imported domestic professional buyable sources", () => {
  const sources = [
    "ChemBridge",
    "ChemicalBook",
    "Bidepharm",
    "Leyan",
    "Macklin",
    "Aladdin",
    "TCI China",
    "MCE China",
  ];

  expect(getDomesticBuyableSources(sources)).toStrictEqual([
    "ChemicalBook",
    "Bidepharm",
    "Leyan",
    "Macklin",
    "Aladdin",
    "TCI China",
    "MCE China",
  ]);
});

test("describes domestic-only buyable source scope", () => {
  const allSources = ["ChemSpace", "ChemicalBook", "Bidepharm"];
  const selected = ["ChemicalBook", "Bidepharm"];

  expect(getBuyableSourceScope(allSources, false, selected)).toStrictEqual({
    key: "domestic",
    label: "国内专业源",
    sources: selected,
    domesticCount: 2,
    selectedCount: 2,
  });
  expect(sourceArgsToDisplay(selected)).toBe("ChemicalBook, Bidepharm");
});
