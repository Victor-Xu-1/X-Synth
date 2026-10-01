import {
  buildRetroBackendCatalog,
  getDefaultRetroTrainingSet,
  getRetroModelItems,
  getRetroTrainingSetItems,
} from "@/common/retro-options";

test("all ASKCOS retro backends remain selectable without readiness status", () => {
  const result = getRetroModelItems([]);

  expect(result.map((item) => item.value)).toStrictEqual([
    "template_relevance",
    "augmented_transformer",
    "graph2smiles",
    "retrosim",
    "exact_match",
    "template_enumeration",
  ]);
  expect(result.every((item) => item.props.disabled === false)).toBe(true);
});

test("training set options include every configured set for the selected backend", () => {
  expect(
    getRetroTrainingSetItems("template_relevance", []).map((item) => item.value)
  ).toStrictEqual([
    "reaxys",
    "pistachio",
    "pistachio_ringbreaker",
    "reaxys_biocatalysis",
    "bkms_metabolic",
    "cas",
    "uspto_higher_level",
  ]);

  expect(
    getRetroTrainingSetItems("retrosim", []).map((item) => item.value)
  ).toStrictEqual(["USPTO_FULL", "bkms"]);
});

test("default training set follows backend-specific ASKCOS defaults", () => {
  expect(getDefaultRetroTrainingSet("template_relevance")).toBe("reaxys");
  expect(getDefaultRetroTrainingSet("graph2smiles")).toBe("pistachio_23Q3");
  expect(getDefaultRetroTrainingSet("exact_match")).toBe("USPTO_FULL");
});

test("runtime capabilities extend the selectable ASKCOS retro catalog", () => {
  const runtimeCapabilities = {
    retrosynthesis_models: [
      {
        id: "internal_reaxys_2026",
        service: "retro_template_relevance",
      },
      {
        id: "custom_set",
        service: "retro_custom_backend",
      },
    ],
  };

  expect(
    getRetroTrainingSetItems("template_relevance", [], runtimeCapabilities).map(
      (item) => item.value
    )
  ).toContain("internal_reaxys_2026");

  expect(
    buildRetroBackendCatalog(runtimeCapabilities).map((item) => item.value)
  ).toContain("custom_backend");

  expect(
    getRetroModelItems([], runtimeCapabilities).map((item) => item.value)
  ).toContain("custom_backend");
  expect(
    getDefaultRetroTrainingSet("custom_backend", [], runtimeCapabilities)
  ).toBe("custom_set");
});
