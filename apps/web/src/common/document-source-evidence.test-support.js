export const copy = value => JSON.parse(JSON.stringify(value));
export function sourceReceipt(grade = "operation_evidence_required") {
  return { version: 1, phase: "automated_review", basis: "route_receipt", grade,
    independent_review: grade === "not_independently_reviewed" ? { status: "missing" }
      : { status: "checked", review_version: 1, model: "graph2smiles_uspto_stereo", total_steps: 2, matched_steps: 2 },
    purchase_identity: { policy: "defined_purchase_identity_v1", status: "defined", unresolved_materials: [] },
    ...(grade === "operation_evidence_required" ? { operations: { policy: "template_operation_evidence_v1",
      status: "evidence_required", unresolved_steps: [{ step_id: "early-original", reasons: ["distinct_disconnected_reaction_centers"] }] } } : {}),
  };
}
export function sourceDocument(patch = {}) {
  return { id: "a".repeat(32), revision: 3, title: "Original research route", state: "source_copy",
    graph: { target_id: "target", nodes: [
      { id: "target", type: "molecule", smiles: "CCO", position: { x: 1090, y: 10 } },
      { id: "r-1", type: "reaction", label: "原始末步", position: { x: 910, y: 80 } },
      { id: "middle", type: "molecule", smiles: "CCCl", position: { x: 550, y: 10 } },
      { id: "r-2", type: "reaction", label: "原始首步", position: { x: 370, y: 80 } },
      { id: "input", type: "molecule", smiles: "[13CH3]C", position: { x: 10, y: 10 } },
    ], edges: [{ id: "e1", source: "middle", target: "r-1" }, { id: "e2", source: "r-1", target: "target" },
      { id: "e3", source: "input", target: "r-2", input_occurrences: 2 }, { id: "e4", source: "r-2", target: "middle" }] },
    source: { job_id: "b".repeat(32), route_id: "original-route", route_index: 0, result_snapshot: "c".repeat(64) },
    metadata: { chemical_signature: "d".repeat(64), delivery_review: sourceReceipt("model_checked") },
    ...patch,
  };
}
export function sourceEvidence(document = sourceDocument(), patch = {}) {
  return { status: "available", scope: document.source.result_snapshot ? "pinned_publication" : "current_matching_source",
    binding: { document_id: document.id, document_revision: document.revision,
      chemical_signature: document.metadata.chemical_signature, ...document.source },
    steps_by_node: {
      "r-1": { step_id: "late-original", product: "CCO", precursors: ["CCCl"], reaction_smiles: "CCCl>>CCO",
        confidence: 0.73, source: "askcos", metadata: {} },
      "r-2": { step_id: "early-original", product: "CCCl", precursors: ["[13CH3]C", "[13CH3]C"],
        reaction_smiles: "[13CH3]C.[13CH3]C>>CCCl", confidence: null, source: null, metadata: null },
    }, metadata: { delivery_review: sourceReceipt(), automated_review: {
      version: 4,
      forward: { records: [{ step_id: "early-original", model: "graph2smiles_uspto_stereo", record_id: "saved-forward",
        expected_rank: 2, feasibility_score: 0.9, matched: true,
        rank_provenance: { rank_basis: "original_decoder_ordinal" } }] },
      references: { records: [{ step_id: "early-original", refs: [
        { id: "exact-ORD", source: "ORD", match_scope: "reaction_identity", url: "https://doi.org/10.1234/example",
          reaction_condition_fields: ["conditions.temperature.setpoint.value", "outcomes[0].reaction_time.value"],
          reaction_yield_measurements: [{ value: 52, unit: "%", product_smiles: "CCCl", source_field: "outcomes[0].products[0].measurements[0].percentage.value" }] },
        { id: "product-patent", source: "USPTO_FULL", match_scope: "product_identity",
          reaction_conditions_recorded: true, reaction_yields_recorded: true },
      ] }] },
    } }, starting_materials: ["[13CH3]C"], closure_sources: ["catalogue-source"], source_closed: true,
    ...patch,
  };
}
export function deferred() {
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
