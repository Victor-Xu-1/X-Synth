import {
  REFERENCE_SOURCE,
  ReferenceContractError,
  recordedValue,
  referenceFailure,
  referenceLimit,
  referencePrefill,
  referenceQuery,
  referenceReactionFileBody,
  referenceReady,
  referenceReason,
  referenceResponse,
  referenceStatus,
  reportedYieldMethod,
  unavailableReferenceStatus,
} from "./reaction-references";

// Isolated transport fixtures, not evidence of real patent records or chemical acceptance.
const ready = {
  ready: true,
  source: REFERENCE_SOURCE,
  record_count: 12,
  product_index_available: true,
  reason: null,
};
const request = { product: "CC=O", reactants: ["CCO"], limit: 20 };
function packet() {
  return {
    requested: { product: "CC=O", reactants: ["CCO"] },
    query: { product: "CC=O", reactants: ["CCO"] },
    source: REFERENCE_SOURCE,
    count: 1,
    has_more: false,
    match_basis: "exact_product_structure",
    retrieved_at: "2026-10-04T08:00:00+00:00",
    results: [
      {
        id: "isolated-reference",
        reaction_smiles: "[CH3:1][CH2:2][OH:3]>>[CH3:1][CH:2]=[O:3]",
        reactants: ["CCO"],
        products: ["CC=O"],
        agents: [],
        match_scope: "reaction_identity",
        patent_number: null,
        patent_url: null,
        paragraph: null,
        year: null,
        conditions: null,
        reported_yields: [
          { value: 0, unit: "%", method: "text_mined_yield", text: "0%" },
        ],
        provenance: {
          source: REFERENCE_SOURCE,
          record_id: "isolated-reference",
          evidence_type: "patent_reaction_extraction",
          yield_extraction_fields: ["text_mined_yield"],
          patent_url_basis: null,
        },
      },
    ],
  };
}

test("query bounds preserve isotope, stereo, charge and disconnected salt records", () => {
  const product = "[13CH3][C@H](O)C.[Na+]",
    reactant = "[13CH3][C@@H](Cl)C.[Cl-]";
  expect(
    referenceQuery({
      product: ` ${product} `,
      reactants: [reactant],
      limit: "30",
    }),
  ).toEqual({ product, reactants: [reactant], limit: 30 });
  expect(referenceQuery({ product: "CCO" })).toEqual({
    product: "CCO",
    reactants: [],
    limit: 20,
  });
});
test.each([0, 31, 1.1, NaN, Infinity, null, true, "", "2e1", " 20 ", {}, []])(
  "invalid limit %p cannot become a query",
  (value) =>
    expect(() => referenceLimit(value)).toThrow(ReferenceContractError),
);
test.each([
  { product: "" },
  { product: "CCO>>CC=O" },
  { product: ["CCO"] },
  { product: "CCO\nCCN" },
  { product: "C".repeat(8193) },
  { product: "CCO\u0000" },
  { product: "CCO\u007f" },
  { product: "CCO", reactants: "CCN" },
  { product: "CCO", reactants: [null] },
  { product: "CCO", reactants: [""] },
  { product: "CCO", reactants: Array(31).fill("CCN") },
])("invalid input case %# is rejected without fragment coercion", (value) => {
  expect(() => referenceQuery(value)).toThrow(ReferenceContractError);
});

test("status requires the exact public source, index and coherent readiness", () => {
  expect(referenceStatus(ready)).toBe(ready);
  expect(referenceReady(ready)).toBe(true);
  expect(referenceStatus({ ...ready, record_count: null }).ready).toBe(true);
  for (const change of [
    { source: "ORD" },
    { product_index_available: false },
    { ready: "true" },
    { record_count: 0 },
    { record_count: -1 },
    { reason: "reference_query_timeout" },
  ])
    expect(() => referenceStatus({ ...ready, ...change })).toThrow(
      ReferenceContractError,
    );
  expect(referenceReady({ ready: true, source: REFERENCE_SOURCE })).toBe(false);
});
test("503 status bodies retain their explicit unavailable reason, never become empty success", () => {
  const unavailable = {
    ...ready,
    ready: false,
    product_index_available: false,
    reason: "reference_product_index_unavailable",
  };
  expect(
    unavailableReferenceStatus(new Error(JSON.stringify(unavailable))),
  ).toEqual(unavailable);
  expect(referenceReason(unavailable)).toContain("索引未就绪");
  expect(referenceFailure(new Error(JSON.stringify(unavailable)))).toContain(
    "索引未就绪",
  );
  expect(unavailableReferenceStatus(new Error("offline"))).toBeNull();
  expect(
    unavailableReferenceStatus(new Error(JSON.stringify(ready))),
  ).toBeNull();
});
test("structured errors use Chinese reference messages", () => {
  expect(
    referenceFailure(
      new Error('{"detail":{"code":"reference_query_timeout"}}'),
    ),
  ).toContain("超时");
  expect(
    referenceFailure(
      new Error('{"detail":{"code":"invalid_reference_structure"}}'),
    ),
  ).toContain("结构");
  expect(referenceFailure(new Error("untrusted network text"))).toContain(
    "检索失败",
  );
});

test.each(["reaction_smiles", "rxnsmiles"])(
  "%s prefill keeps a full product salt and never changes stereo",
  (key) => {
    const raw = "[13CH3][C@H](Cl)C.[Cl-]>O>[13CH3][C@@H](O)C.[Na+]";
    expect(referencePrefill({ [key]: raw })).toEqual({
      reaction_smiles: raw,
      reactants: ["[13CH3][C@H](Cl)C.[Cl-]"],
      product: "[13CH3][C@@H](O)C.[Na+]",
      agents: ["O"],
    });
  },
);
test("absent links do not invent a reaction; ambiguous or incomplete links cannot apply", () => {
  expect(referencePrefill({})).toBeNull();
  for (const query of [
    { rxnsmiles: ["CCO>>CC=O"] },
    { reaction_smiles: "" },
    { rxnsmiles: "CCO>CC=O" },
    { rxnsmiles: "CCO>>>CC=O" },
    { rxnsmiles: ">>CC=O" },
    { rxnsmiles: "CCO>>CC=O", reaction_smiles: "CCN>>CC=N" },
  ])
    expect(() => referencePrefill(query)).toThrow(ReferenceContractError);
});

test("real DTO fields stay distinct and raw mapped SMILES remain untouched", () => {
  const value = packet(),
    raw = value.results[0].reaction_smiles;
  expect(referenceResponse(value, request)).toBe(value);
  expect(value.results[0].reaction_smiles).toBe(raw);
  expect(recordedValue(0)).toBe("0");
  expect(recordedValue(null)).toBe("未记录");
  expect(reportedYieldMethod("calculated_yield")).toBe("计算收率字段");
});
test.each([
  undefined,
  null,
  [],
  {},
  { product: "CC=O" },
  { reactants: ["CCO"] },
  { product: "CC=O", reactants: "CCO" },
  { product: "CC=O", reactants: [null] },
  { product: "CC=N", reactants: ["CCO"] },
  { product: "CC=O", reactants: ["CCN"] },
  { product: "C(C)=O", reactants: ["CCO"] },
  { product: "CC=O", reactants: ["OCC"] },
  { product: " CC=O ", reactants: ["CCO"] },
  { product: "CC=O", reactants: [" CCO "] },
])(
  "mandatory requested echo case %# must equal the captured raw-trimmed payload",
  (echo) => {
    const value = packet();
    value.requested = echo;
    expect(() => referenceResponse(value, request)).toThrow(
      ReferenceContractError,
    );
  },
);
test("noncanonical captured input accepts its exact raw echo and separate canonical query", () => {
  const input = { product: " C(C)=O ", reactants: [" OCC "], limit: 20 },
    value = packet();
  value.requested = { product: "C(C)=O", reactants: ["OCC"] };
  expect(referenceResponse(value, input)).toBe(value);
  expect(value.query).toEqual({ product: "CC=O", reactants: ["CCO"] });
  expect(value.requested).toEqual({ product: "C(C)=O", reactants: ["OCC"] });
  expect(input.reactants).toEqual([" OCC "]);
});
test("requested reactant order and duplicates cannot be replaced by a component multiset", () => {
  const input = { ...request, reactants: ["CCO", "O", "O"] },
    value = packet();
  value.requested = { product: input.product, reactants: [...input.reactants] };
  value.query.reactants = [...input.reactants];
  value.results[0].reactants = [...input.reactants];
  expect(referenceResponse(value, input)).toBe(value);
  value.requested.reactants = ["O", "CCO", "O"];
  expect(() => referenceResponse(value, input)).toThrow(ReferenceContractError);
  value.requested.reactants = ["CCO", "O", "N"];
  expect(() => referenceResponse(value, input)).toThrow(ReferenceContractError);
});
test.each([
  { field: "product", changed: "C[C@H](O)C.[Na+]" },
  { field: "product", changed: "[13CH3][C@@H](O)C.[Na+]" },
  { field: "product", changed: "[13CH3][C@H](O)C" },
  { field: "reactants", changed: ["C[C@@H](Cl)C.[Cl-]"] },
  { field: "reactants", changed: ["[13CH3][C@H](Cl)C.[Cl-]"] },
  { field: "reactants", changed: ["[13CH3][C@@H](Cl)C"] },
])(
  "requested identity changes case %# cannot attach metadata from another input",
  ({ field, changed }) => {
    const input = {
      product: "[13CH3][C@H](O)C.[Na+]",
      reactants: ["[13CH3][C@@H](Cl)C.[Cl-]"],
      limit: 20,
    };
    const value = packet();
    value.requested = {
      product: input.product,
      reactants: [...input.reactants],
    };
    value.query = { product: input.product, reactants: [...input.reactants] };
    value.results[0].products = [input.product];
    value.results[0].reactants = [...input.reactants];
    expect(referenceResponse(value, input)).toBe(value);
    value.requested[field] = changed;
    expect(() => referenceResponse(value, input)).toThrow(
      ReferenceContractError,
    );
  },
);
test.each([
  (value) => {
    value.source = "ord_extracted";
  },
  (value) => {
    value.match_basis = "model_prediction";
  },
  (value) => {
    value.query = null;
  },
  (value) => {
    value.query.reactants = [];
  },
  (value) => {
    value.count = 0;
  },
  (value) => {
    value.has_more = "false";
  },
  (value) => {
    value.retrieved_at = "2026-10-04";
  },
  (value) => {
    value.results[0].products = ["CCN"];
  },
  (value) => {
    value.results[0].match_scope = "product_identity";
  },
  (value) => {
    value.results[0].conditions = { predicted_temperature: 25 };
  },
  (value) => {
    value.results[0].reported_yields[0].value = "85";
  },
  (value) => {
    value.results[0].reported_yields[0].value = Infinity;
  },
  (value) => {
    value.results[0].reported_yields[0].unit = "fraction";
  },
  (value) => {
    value.results[0].reported_yields[0].method = "model_prediction";
  },
  (value) => {
    value.results[0].reported_yields[0].text = "";
  },
  (value) => {
    value.results[0].provenance.record_id = "other-record";
  },
  (value) => {
    value.results[0].provenance.evidence_type = "template";
  },
  (value) => {
    value.results[0].provenance.yield_extraction_fields = [];
  },
  (value) => {
    value.results[0].year = false;
  },
])("inconsistent or prediction-shaped responses are rejected %#", (change) => {
  const value = packet();
  change(value);
  expect(() => referenceResponse(value, request)).toThrow(
    ReferenceContractError,
  );
});
test("limits, duplicate records and empty results have strict counts", () => {
  const value = packet();
  value.results.push(value.results[0]);
  value.count = 2;
  expect(() => referenceResponse(value, request)).toThrow(
    ReferenceContractError,
  );
  expect(() => referenceResponse(value, { ...request, limit: 1 })).toThrow(
    ReferenceContractError,
  );
  expect(
    referenceResponse({ ...packet(), results: [], count: 0 }, request).count,
  ).toBe(0);
});
test("product-only input cannot gain a full-reaction claim", () => {
  const value = packet();
  value.query.reactants = [];
  value.requested.reactants = [];
  expect(() => referenceResponse(value, { product: "CC=O" })).toThrow(
    ReferenceContractError,
  );
  value.results[0].match_scope = "product_identity";
  expect(referenceResponse(value, { product: "CC=O" })).toBe(value);
});
test("canonical salt component order is not mistaken for different chemistry", () => {
  const value = packet();
  value.query.product = "[Cl-].[13CH3][C@H](O)C";
  value.requested.product = value.query.product;
  value.results[0].products = ["[13CH3][C@H](O)C", "[Cl-]"];
  expect(
    referenceResponse(value, { ...request, product: value.query.product }),
  ).toBe(value);
  value.results[0].products[0] = "[13CH3][C@@H](O)C";
  expect(() =>
    referenceResponse(value, { ...request, product: value.query.product }),
  ).toThrow();
});
test("RXN export includes every supplied component and agent, without guessed conditions", () => {
  const row = {
    reactants: ["[13CH3][C@H](Cl)C.[Cl-]"],
    products: ["[13CH3][C@@H](O)C", "[Na+]"],
    agents: ["O"],
  };
  expect(referenceReactionFileBody(row)).toEqual({
    reactants: [...row.reactants],
    product: "[13CH3][C@@H](O)C.[Na+]",
    agents: ["O"],
  });
  expect(() => referenceReactionFileBody({ ...row, reactants: [] })).toThrow();
  expect(() =>
    referenceReactionFileBody({ ...row, reactants: Array(100).fill("CCO") }),
  ).toThrow();
});
