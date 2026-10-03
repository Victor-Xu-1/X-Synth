export async function expandMolecule(
  api,
  { smiles, model = "pistachio", count = 1000, threshold = 0.75 },
) {
  const canonical = (await api.post("/api/v1/structure/validate", { smiles }))
    .smiles;
  const value = await api.post(
    "/api/tree-search/expand-one/call-sync-without-token",
    {
      smiles: canonical,
      retro_backend_options: [
        {
          retro_backend: "template_relevance",
          retro_model_name: model,
          max_num_templates: count,
          max_cum_prob: 0.999,
        },
      ],
      retro_rerank_backend: "scscore",
      use_fast_filter: true,
      fast_filter_threshold: threshold,
      cluster_precursors: false,
      return_reacting_atoms: false,
      selectivity_check: false,
    },
  );
  const outcomes = Array.isArray(value) ? value : value.result;
  if (!Array.isArray(outcomes))
    throw new Error("ASKCOS 返回了无效的候选格式。");
  return {
    canonical,
    model,
    outcomes: outcomes.map((item) => ({
      ...item,
      plausibility: item.reaction_properties?.plausibility ?? item.plausibility,
    })),
  };
}
