/** @jest-environment node */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  referenceResponse,
  referenceStatus,
  ReferenceContractError,
} from "./reaction-references";
import {
  evidenceCitation,
  recordedNumber,
  recordedParameter,
  recordedTimeLabel,
  yieldAnalysisLabel,
} from "./reference-evidence";

const original = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../tests/fixtures/reactions/ord-astra-zeneca.json",
    ),
    "utf8",
  ),
);
const request = {
  product: original.products[0],
  reactants: original.reactants,
  limit: 20,
};
const sources = [
  {
    source: "ORD",
    ready: true,
    product_index_available: true,
    record_count: 750,
    reason: null,
    license: "CC-BY-SA-4.0",
    snapshot: original.provenance.source_sha256,
  },
];
const packet = () => ({
  source: "ORD",
  sources,
  query: { product: request.product, reactants: request.reactants },
  requested: { product: request.product, reactants: request.reactants },
  results: [{ ...original, match_scope: "reaction_identity" }],
  count: 1,
  has_more: false,
  match_basis: "exact_product_structure",
  retrieved_at: "2026-10-04T08:00:00+00:00",
});

test("real deposited ORD evidence shares exact-query binding and preserves provenance", () => {
  const value = packet();
  expect(referenceResponse(value, request)).toBe(value);
  expect(value.results[0].reported_yields[0].value).toBeCloseTo(65.39, 5);
  expect(
    referenceStatus({
      source: "ORD",
      sources,
      ready: true,
      record_count: 750,
      product_index_available: true,
      reason: null,
    }).ready,
  ).toBe(true);
  expect(evidenceCitation(original).url).toBe(original.publication_url);
});

test("different reaction inputs, unavailable source, missing license and tampered quantities fail closed", () => {
  for (const change of [
    (value) => (value.requested.reactants = []),
    (value) =>
      (value.sources = [
        {
          ...sources[0],
          ready: false,
          product_index_available: false,
          reason: "reaction_library_invalid",
        },
      ]),
    (value) => (value.results[0].provenance.license = null),
    (value) => (value.results[0].provenance.source_sha256 = "invalid"),
    (value) => (value.results[0].conditions.temperature[0].value = "110"),
    (value) => (value.results[0].conditions.temperature[0].precision = -10),
  ]) {
    const value = JSON.parse(JSON.stringify(packet()));
    change(value);
    expect(() => referenceResponse(value, request)).toThrow(
      ReferenceContractError,
    );
  }
});

test("protobuf numeric display does not expose spurious float precision or relabel addition as reaction time", () => {
  expect(recordedNumber(original.reported_yields[0].value)).toBe("65.39");
  expect(recordedParameter(original.conditions.temperature[0])).toBe(
    "110 ± 10 °C",
  );
  expect(recordedNumber(0)).toBe("0");
  expect(
    recordedParameter({
      value: 0,
      unit: "UNSPECIFIED",
      source_field: "conditions.temperature",
    }),
  ).toBe("0 单位未记录");
  expect(
    recordedTimeLabel({ source_field: 'inputs["feed"].addition_duration' }),
  ).toBe("加料时长");
  expect(
    recordedTimeLabel({ source_field: 'inputs["feed"].addition_time' }),
  ).toBe("加料时间点");
  expect(recordedTimeLabel({ source_field: "outcomes[0].reaction_time" })).toBe(
    "反应时间",
  );
  expect(yieldAnalysisLabel(original.reported_yields[0])).toBe(
    "测量方法未记录",
  );
});

test("a publication link cannot become a javascript or credential-bearing link", () => {
  expect(
    evidenceCitation({ publication_url: "javascript:alert(1)" }),
  ).toBeNull();
  expect(
    evidenceCitation({
      publication_url: "https://private:secret@example.test/",
    }),
  ).toBeNull();
});
