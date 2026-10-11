/** @jest-environment node */
import Papa from "papaparse";
import { acceptsForwardResult } from "./forward-provenance";
import { forwardCsv, forwardLedger, forwardProvenance } from "./forward-results";
import { rankedForwardFixture, incompleteForwardFixture, leadingIncompleteForwardFixture } from "./forward-result.test-support";

test("decoder 2 promoted to joint 1 retains every original rank and the unsliced 30-row ledger", () => {
  const result = rankedForwardFixture(), before = JSON.stringify(result);
  expect(acceptsForwardResult(result)).toBe(true);
  expect(result.products[0]).toMatchObject({ decoder_rank: 2, native_rank: 2, joint_rank: 1 });
  const ledger = forwardLedger(forwardProvenance(result));
  expect(result.products).toHaveLength(10);
  expect(ledger).toHaveLength(30);
  expect(ledger[29]).toMatchObject({ decoder_rank: 30, native_rank: 27, joint_rank: 25 });
  expect(ledger[2]).toMatchObject({ decoder_disposition: "duplicate", duplicate_of: 1, native_rank: null, joint_rank: null });
  expect(ledger[5]).toMatchObject({ filter_disposition: "no_op", feasibility_score: null, joint_rank: null });
  expect(JSON.stringify(result)).toBe(before);
});

test.each([undefined, null])("legacy provenance %s never acquires ranks or guessed scorer identity", (provenance) => {
  const result = { reactants: "CCO", model: "legacy-model", asset_identity: "a".repeat(64), provenance,
    products: [{ product: "CC=O", log_probability: -2, feasibility_score: 0 },
      { product: "CO", log_probability: -1, feasibility_score: 1 }] };
  const before = JSON.stringify(result);
  expect(acceptsForwardResult(result)).toBe(true);
  expect(forwardProvenance(result)).toBeNull();
  const csv = Papa.parse(forwardCsv(result), { header: true }).data;
  expect(csv.map((row) => row.product)).toEqual(["CC=O", "CO"]);
  expect(csv.map((row) => row.saved_joint_ordinal)).toEqual(["1", "2"]);
  expect(csv.every((row) => row.decoder_rank === "" && row.native_rank === "" && row.joint_rank === "")).toBe(true);
  expect(csv[0]).toMatchObject({ rank_basis: "joint_display_ordinal", fast_filter_asset_identity: "", ranking_policy: "" });
  expect(JSON.stringify(result)).toBe(before);
});

test.each(["decoder_rank", "native_rank", "joint_rank"])("legacy cannot smuggle an unbound %s", (key) => {
  const result = rankedForwardFixture();
  delete result.provenance;
  result.products = [{ product: "CO", log_probability: -1, feasibility_score: 0.9, [key]: 1 }];
  expect(acceptsForwardResult(result)).toBe(false);
});

test.each([
  ["unknown version", (r) => { r.provenance.version = 2; }],
  ["boolean ranking version", (r) => { r.provenance.version = true; }],
  ["string ranking version", (r) => { r.provenance.version = "1"; }],
  ["boolean decoder version", (r) => { r.provenance.decoder.version = true; }],
  ["string decoder version", (r) => { r.provenance.decoder.version = "1"; }],
  ["wrong basis", (r) => { r.provenance.rank_basis = "joint_display_ordinal"; }],
  ["wrong policy", (r) => { r.provenance.ranking_policy = "score_sort"; }],
  ["missing FF identity", (r) => { r.provenance.fast_filter_asset_identity = null; }],
  ["bad forward identity", (r) => { r.asset_identity = "invalid"; }],
  ["bad bounds", (r) => { r.provenance.decoder.parameters.n_best = 31; }],
  ["lost decoder ordinal", (r) => { r.provenance.decoder.hypotheses[29].decoder_rank = 29; }],
  ["duplicate native rank", (r) => { r.provenance.decoder.hypotheses[1].native_rank = 1; }],
  ["bad duplicate binding", (r) => { r.provenance.decoder.hypotheses[2].duplicate_of = 2; }],
  ["invented invalid product", (r) => { r.provenance.decoder.hypotheses[3].product = "C"; }],
  ["missing decision beyond display", (r) => { r.provenance.decisions.pop(); }],
  ["wrong decision native rank", (r) => { r.provenance.decisions[1].native_rank = 1; }],
  ["filtered score", (r) => { r.provenance.decisions[2].feasibility_score = 0; }],
  ["unbound no-op", (r) => { r.provenance.decisions[2].disposition = "unsupplied_atoms"; }],
  ["wrong joint score", (r) => { r.provenance.decisions[1].joint_score = 0; }],
  ["wrong joint rank beyond display", (r) => { r.provenance.decisions.at(-1).joint_rank = 1; }],
  ["rank interpreted as display order", (r) => { r.products[0].decoder_rank = 1; }],
  ["non-prefix display", (r) => { r.products.reverse(); }],
  ["display dropped despite ranked results", (r) => { r.products = []; }],
])("invalid provenance fails closed: %s", (_name, mutate) => {
  const result = rankedForwardFixture();
  mutate(result);
  expect(acceptsForwardResult(result)).toBe(false);
  expect(forwardProvenance(result)).toBeNull();
  expect(forwardCsv(result)).toBe("");
});

test("modern CSV exports all decoder rows, scores, three ranks, basis and both real assets", () => {
  const result = rankedForwardFixture(), before = JSON.stringify(result);
  const rows = Papa.parse(forwardCsv(result), { header: true }).data;
  expect(rows).toHaveLength(30);
  expect(rows[1]).toMatchObject({
    decoder_rank: "2", native_rank: "2", joint_rank: "1", saved_joint_ordinal: "",
    rank_basis: "original_decoder_ordinal", ranking_policy: result.provenance.ranking_policy,
    forward_asset_identity: result.asset_identity, fast_filter_asset_identity: "b".repeat(64),
    fast_filter_model: "askcos_fast_filter", log_probability: "-0.2", feasibility_score: "0.9",
  });
  expect(rows[29]).toMatchObject({ decoder_rank: "30", native_rank: "27", joint_rank: "25" });
  expect(rows[2]).toMatchObject({ decoder_disposition: "duplicate", duplicate_of: "1", native_rank: "", joint_rank: "" });
  expect(rows[3]).toMatchObject({ decoder_disposition: "invalid_decoding", product: "" });
  expect(rows[6]).toMatchObject({ filter_disposition: "unsupplied_atoms", feasibility_score: "", joint_score: "" });
  expect(JSON.stringify(result)).toBe(before);
});

test("an empty modern ranked set keeps its decoder ledger without guessing fast-filter assets", () => {
  const result = rankedForwardFixture();
  result.products = [];
  result.provenance.decoder.hypotheses = [result.provenance.decoder.hypotheses[3]];
  result.provenance.decoder.hypotheses[0].decoder_rank = 1;
  result.provenance.decisions = [];
  result.provenance.fast_filter_asset_identity = null;
  expect(acceptsForwardResult(result)).toBe(true);
  expect(Papa.parse(forwardCsv(result), { header: true }).data[0]).toMatchObject({
    decoder_rank: "1", native_rank: "", joint_rank: "", fast_filter_asset_identity: "",
  });
});

test("mapped decoding and canonical product remain separate verbatim fields with stereo, isotope and salt identity", () => {
  const result = rankedForwardFixture();
  const decoded = "[13CH3:1][C@H:2]([F:3])[Cl:4].[Na+]", product = "[13CH3][C@H](F)Cl.[Na+]";
  Object.assign(result.provenance.decoder.hypotheses[0], { decoded_product: decoded, product });
  Object.assign(result.provenance.decoder.hypotheses[2], { decoded_product: decoded, product });
  result.products[1].product = product;
  const before = JSON.stringify(result), rows = Papa.parse(forwardCsv(result), { header: true }).data;
  expect(rows[0]).toMatchObject({ decoded_product: decoded, product });
  expect(rows[2]).toMatchObject({ decoded_product: decoded, product, decoder_disposition: "duplicate" });
  expect(JSON.stringify(result)).toBe(before);
});

test("EOS unfinished hypotheses preserve the last raw token and termination facts without entering native or joint ranking", () => {
  const result = incompleteForwardFixture(), before = JSON.stringify(result);
  expect(acceptsForwardResult(result)).toBe(true);
  const ledger = forwardLedger(forwardProvenance(result));
  expect(ledger[3]).toMatchObject({
    decoded_product: "[13CH3:1][C@H:2]([F:3])[Cl:4].[Na+]", terminated_by_eos: false,
    decoded_token_count: 512, decoder_disposition: "incomplete_decoding", product: null,
    native_rank: null, joint_rank: null, duplicate_of: null, feasibility_score: null, joint_score: null,
  });
  expect(ledger).toHaveLength(30);
  expect(result.products).toHaveLength(10);
  expect(result.provenance.decisions.some((row) => row.decoder_rank === 4)).toBe(false);
  expect(result.products.some((row) => row.decoder_rank === 4)).toBe(false);
  expect(JSON.stringify(result)).toBe(before);
});

test("EOS CSV retains both termination fields verbatim for every decoder row, including unfinished raw strings", () => {
  const result = incompleteForwardFixture(), before = JSON.stringify(result);
  const rows = Papa.parse(forwardCsv(result), { header: true }).data;
  expect(rows).toHaveLength(30);
  expect(rows[0]).toMatchObject({ terminated_by_eos: "true", decoded_token_count: "16" });
  expect(rows[3]).toMatchObject({
    terminated_by_eos: "false", decoded_token_count: "512", decoder_disposition: "incomplete_decoding",
    decoded_product: result.provenance.decoder.hypotheses[3].decoded_product,
    product: "", native_rank: "", joint_rank: "", duplicate_of: "", filter_disposition: "",
  });
  expect(rows[29]).toMatchObject({ terminated_by_eos: "true", decoded_token_count: "16" });
  expect(JSON.stringify(result)).toBe(before);
});

test.each([0, 17, 512])("EOS token count %s is opaque recorded metadata, not inferred from the same decoded string", (count) => {
  const result = incompleteForwardFixture(), raw = result.provenance.decoder.hypotheses[3].decoded_product;
  result.provenance.decoder.hypotheses[3].decoded_token_count = count;
  expect(acceptsForwardResult(result)).toBe(true);
  const row = forwardLedger(forwardProvenance(result))[3];
  expect(row.decoded_token_count).toBe(count);
  expect(row.decoded_product).toBe(raw);
  expect(Papa.parse(forwardCsv(result), { header: true }).data[3].decoded_token_count).toBe(String(count));
});

test.each([undefined, null, 0, 1, "true", "false", {}, []])(
  "EOS termination must be an explicit strict boolean, not %p", (value) => {
    const result = rankedForwardFixture();
    result.provenance.decoder.hypotheses[0].terminated_by_eos = value;
    expect(acceptsForwardResult(result)).toBe(false);
    expect(forwardCsv(result)).toBe("");
  },
);

test.each([undefined, null, true, false, "16", -1, 0.5, 513, NaN, Infinity])(
  "EOS decoded_token_count rejects missing, coerced or out-of-range value %p", (value) => {
    const result = rankedForwardFixture();
    result.provenance.decoder.hypotheses[0].decoded_token_count = value;
    expect(acceptsForwardResult(result)).toBe(false);
  },
);

test("EOS token count is bounded by the decoder's recorded maximum, not only by 512", () => {
  const result = rankedForwardFixture();
  result.provenance.decoder.hypotheses[0].decoded_token_count = 257;
  expect(acceptsForwardResult(result)).toBe(false);
});

test.each(["returned", "duplicate", "invalid_decoding", "unsupported_structure"])(
  "EOS is required for existing disposition %s, even when raw decoding resembles a valid structure", (disposition) => {
    const result = rankedForwardFixture();
    result.provenance.decoder.hypotheses.find((row) => row.disposition === disposition).terminated_by_eos = false;
    expect(acceptsForwardResult(result)).toBe(false);
  },
);

test.each([
  ["EOS true", (r) => { r.provenance.decoder.hypotheses[3].terminated_by_eos = true; }],
  ["product", (r) => { r.provenance.decoder.hypotheses[3].product = "CCO"; }],
  ["native rank", (r) => { r.provenance.decoder.hypotheses[3].native_rank = 3; }],
  ["duplicate binding", (r) => { r.provenance.decoder.hypotheses[3].duplicate_of = 1; }],
  ["native disposition", (r) => { r.provenance.decoder.hypotheses[3].disposition = "returned"; }],
  ["filter decision", (r) => { r.provenance.decisions.push({
    decoder_rank: 4, native_rank: 3, disposition: "ranked", feasibility_score: 1, joint_score: -4, joint_rank: 3,
  }); }],
  ["displayed product", (r) => { r.products[0] = { ...r.products[0], decoder_rank: 4 }; }],
])("EOS incomplete decoding cannot acquire %s", (_name, change) => {
  const result = incompleteForwardFixture();
  change(result);
  expect(acceptsForwardResult(result)).toBe(false);
  expect(forwardCsv(result)).toBe("");
});

test("EOS an entirely unfinished run keeps raw decoding and token count zero without inventing native candidates", () => {
  const result = incompleteForwardFixture();
  result.provenance.decoder.hypotheses = [{ ...result.provenance.decoder.hypotheses[3],
    decoder_rank: 1, decoded_product: "", decoded_token_count: 0 }];
  result.provenance.decisions = []; result.provenance.fast_filter_asset_identity = null;
  result.products = [];
  expect(acceptsForwardResult(result)).toBe(true);
  expect(Papa.parse(forwardCsv(result), { header: true }).data[0]).toMatchObject({
    decoded_product: "", decoded_token_count: "0", terminated_by_eos: "false", product: "", native_rank: "", joint_rank: "",
  });
});

test("EOS legacy CSV leaves both termination fields unrecorded instead of inventing false or zero", () => {
  const result = { reactants: "CCO", products: [{ product: "CO", log_probability: -1, feasibility_score: 0.9 }] };
  expect(acceptsForwardResult(result)).toBe(true);
  expect(Papa.parse(forwardCsv(result), { header: true }).data[0]).toMatchObject({
    terminated_by_eos: "", decoded_token_count: "",
  });
});

test("EOS unfinished decoder one never renumbers the original model rank of the surviving native and joint first candidate", () => {
  const result = leadingIncompleteForwardFixture(), before = JSON.stringify(result);
  expect(acceptsForwardResult(result)).toBe(true);
  expect(result.products[0]).toMatchObject({ decoder_rank: 2, native_rank: 1, joint_rank: 1 });
  expect(forwardLedger(forwardProvenance(result))[0]).toMatchObject({
    decoder_rank: 1, native_rank: null, joint_rank: null, terminated_by_eos: false, decoded_token_count: 512,
  });
  expect(Papa.parse(forwardCsv(result), { header: true }).data[1]).toMatchObject({
    decoder_rank: "2", native_rank: "1", joint_rank: "1", terminated_by_eos: "true", decoded_token_count: "16",
  });
  expect(JSON.stringify(result)).toBe(before);
});
