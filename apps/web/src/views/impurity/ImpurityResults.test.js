import { flushPromises, mount } from "@vue/test-utils";
import { DEFAULT_LOCALE, setLocale } from "@/i18n";
import ImpurityResults from "./ImpurityResults.vue";
import { IMPURITY_RANKING_STRATEGY } from "./impurity-form";
jest.mock("@/components/SmilesImage.vue", () => ({ name: "SmilesImage", props: ["smiles"], template: '<code>{{ smiles }}</code>' }));

// Protocol metadata only: no trained-model result or native acceptance is claimed.
const result = {
  record_id: "a".repeat(32), known_major_product: { smiles: "[13CH3][C@H]([NH3+])CO.[Cl-]" },
  candidates: [], notices: ["研究者实验原始说明：需要复测。"],
  execution: { candidate_count_before_limit: 0, forward_calls: 0, mapping_calls: 0, mapping_rejected: 0, elapsed_seconds: 0 },
  provenance: { ranking_strategy: IMPURITY_RANKING_STRATEGY, algorithm_source_sha256: "a".repeat(64),
    integration_source_sha256: "b".repeat(64), forward_model: "graph2smiles_uspto_stereo", forward_asset_identity: "c".repeat(64),
    fast_filter_model: "native_fast_filter", mapper_model: "RXNMapper", mapper_package_version: "0.4.2", mapper_license: "MIT",
    mapper_asset_identity: "d".repeat(64), mapper_reference_url: "https://doi.org/10.1126/sciadv.abe4166" },
};
test("English-default impurity empty state and full interpolation remain scientifically limited and retain raw records", async () => {
  const original = JSON.stringify(result);
  setLocale(DEFAULT_LOCALE, { persist: false });
  const wrapper = mount(ImpurityResults, { props: { result }, global: { stubs: { VIcon: true, RouterLink: true } } });
  try {
    expect(wrapper.text()).toContain("Model-predicted potential impurities");
    expect(wrapper.text()).toContain("0 / 0 model candidates reported");
    expect(wrapper.text()).toContain("This does not mean impurity-free, risk-free or not detected experimentally.");
    expect(wrapper.text()).toContain(result.known_major_product.smiles); expect(wrapper.text()).toContain(result.notices[0]);
    expect(wrapper.text()).toContain("graph2smiles_uspto_stereo"); expect(wrapper.text()).toContain("MIT");
    const code = wrapper.findAll("code")[0].element;
    setLocale("zh-CN", { persist: false }); await flushPromises();
    expect(wrapper.text()).toContain("不等于无杂质、无风险或实验未检出。"); expect(wrapper.findAll("code")[0].element).toBe(code);
    expect(JSON.stringify(result)).toBe(original);
  } finally { wrapper.unmount(); }
});

test("known native modes and scientific limitations translate only in presentation, with zero and missing scores distinct", async () => {
  const notice = "联合评分不是经校准的成功率、风险、浓度或检出概率。";
  const value = { ...result, notices: [notice, result.notices[0]], candidates: [{ product: "N[C@@H](C)C(=O)O", molecular_weight_g_mol: 89.09,
    similarity_to_known_product: 0, origins: [{ mode: 2, mode_label: "过度反应", reactants: "[Na+].CC(=O)[O-]",
      log_probability: 0, feasibility_score: 0, mapping_confidence: null, required_fragments: [], mapping: { mapped_reaction: "[CH3:1]>>[CH3:1]" } }] }] };
  const original = JSON.stringify(value);
  setLocale(DEFAULT_LOCALE, { persist: false });
  const wrapper = mount(ImpurityResults, { props: { result: value }, global: { stubs: { VIcon: true, RouterLink: true } } });
  try {
    expect(wrapper.get("option").text()).toBe("Overreaction · source 1");
    expect(wrapper.text()).toContain("The joint score is not a calibrated success rate, risk, concentration or detection probability.");
    expect(wrapper.text()).toContain("0.0000"); expect(wrapper.text()).toContain("Not provided");
    expect(wrapper.text()).toContain(result.notices[0]);
    const select = wrapper.get("select").element;
    setLocale("zh-CN", { persist: false }); await flushPromises();
    expect(wrapper.get("select").element).toBe(select); expect(select.value).toBe("0");
    expect(wrapper.get("option").text()).toBe("过度反应 · 来源 1"); expect(wrapper.text()).toContain(notice);
    expect(JSON.stringify(value)).toBe(original);
  } finally { wrapper.unmount(); }
});
