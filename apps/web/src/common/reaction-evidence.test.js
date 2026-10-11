import {
  buildReactionEvidence,
  createConditionRecommendationUrl,
  createReactionEvidenceInput,
  createPatentLinks,
  normalizePatentNumber,
} from "@/common/reaction-evidence";

test("internal template references cannot become fabricated publication or patent links", () => {
  const evidence = buildReactionEvidence({
    reactionData: {
      document_id: "7bc41b373203fc50b7bada7b31865f35",
      doi: "internal-record-id",
    },
  });
  expect(evidence.links).toEqual([]);
});

test("normalizes WO patent numbers into public patent links", () => {
  expect(normalizePatentNumber("WO2024/59806; A1")).toBe("WO2024059806A1");

  expect(createPatentLinks("WO2024/59806; A1")).toStrictEqual([
    {
      key: "patent-google-WO2024059806A1",
      label: "Google Patents",
      href: "https://patents.google.com/patent/WO2024059806A1",
      value: "WO2024059806A1",
      type: "patent",
    },
    {
      key: "patent-espacenet-WO2024059806A1",
      label: "Espacenet",
      href: "https://worldwide.espacenet.com/patent/search?q=pn%3DWO2024059806A1",
      value: "WO2024059806A1",
      type: "patent",
    },
  ]);
});

test("builds evidence links from reaction data without an explicit source URL", () => {
  const evidence = buildReactionEvidence({
    reactionData: {
      patent_number: "WO2024/59806; A1",
      doi: "10.1021/acs.joc.0c00000",
      pmid: "12345678",
      reaction_smiles: "CCO>>CC=O",
    },
    reactionId: "RX-42",
    reactionSet: "USPTO_FULL",
  });

  expect(evidence.links.map((link) => link.href)).toContain(
    "https://patents.google.com/patent/WO2024059806A1",
  );
  expect(evidence.links.map((link) => link.href)).toContain(
    "https://doi.org/10.1021/acs.joc.0c00000",
  );
  expect(evidence.links.map((link) => link.href)).toContain(
    "https://pubmed.ncbi.nlm.nih.gov/12345678/",
  );
  expect(evidence.fields).toEqual(
    expect.arrayContaining([
      { label: "参考反应", value: "CCO>>CC=O", kind: "reaction" },
      { label: "专利号", value: "WO2024/59806; A1", kind: "text" },
    ]),
  );
});

test("preserves explicit reference URLs and extracts condition fields", () => {
  const evidence = buildReactionEvidence({
    reactionData: {
      reference_url: "https://patents.google.com/patent/US20240123456A1",
      reference: "US20240123456A1",
      solvent: "DCM",
      reagent: "BCl3",
      temperature: "0 C - 20 C",
      yield: "52%",
      procedure:
        "Boron trichloride was added to a stirring solution and warmed to room temperature.",
    },
  });

  expect(evidence.links[0]).toMatchObject({
    label: "原始来源",
    href: "https://patents.google.com/patent/US20240123456A1",
    type: "source",
  });
  expect(evidence.conditions).toStrictEqual([
    { label: "试剂", value: "BCl3" },
    { label: "溶剂", value: "DCM" },
    { label: "温度", value: "0 C - 20 C" },
    { label: "收率", value: "52%" },
    {
      label: "实验步骤",
      value:
        "Boron trichloride was added to a stirring solution and warmed to room temperature.",
    },
  ]);
});

test("extracts evidence input from ASKCOS reaction records", () => {
  const reaction = {
    reaction_id: "USPTO-RXN-1",
    reaction_set: "USPTO_FULL",
    reaction_data: {
      patent_number: "US20240123456A1",
      reaction_smiles: "CCBr.O>>CCO",
    },
  };

  expect(createReactionEvidenceInput(reaction)).toStrictEqual({
    reactionData: reaction.reaction_data,
    reactionId: "USPTO-RXN-1",
    reactionSet: "USPTO_FULL",
  });
});

test("builds condition recommendation URLs from route reaction smiles", () => {
  expect(createConditionRecommendationUrl("CCO>>CC=O")).toBe(
    "/forward?tab=context&rxnsmiles=CCO%3E%3ECC%3DO",
  );
});

const savedOrd = (datasetName = "Training data from https://doi.org/10.1039/C8SC04228D") => ({
  snapshot: "5".repeat(64),
  provenance: {
    source: "ORD", evidence_type: "structured_reaction_record",
    dataset_id: "ord_dataset-e7830cd6b11158b43994ccfb5ee9acb3",
    dataset_name: datasetName, source_sha256: "4".repeat(64),
    original_reaction_id: "ord-59c178d093644ada8b89fd56b0d7d294",
    license: "CC-BY-SA-4.0",
  },
});

test("reader-fix saved dataset attribution is separate from target-reaction evidence and does not mutate the record", () => {
  const reaction = { metadata: { model_metadata: [{ source: { reaction_data: savedOrd() } }] } };
  const before = JSON.stringify(reaction);
  const input = createReactionEvidenceInput({ ...reaction.metadata, ...reaction });
  const evidence = buildReactionEvidence(input);
  expect(evidence.links).toEqual([]);
  expect(evidence.conditions).toEqual([]);
  expect(evidence.dataset.fields).toEqual(expect.arrayContaining([
    { label: "数据集", value: reaction.metadata.model_metadata[0].source.reaction_data.provenance.dataset_name },
    { label: "数据集 ID", value: "ord_dataset-e7830cd6b11158b43994ccfb5ee9acb3" },
    { label: "数据源快照 SHA256", value: "5".repeat(64) },
    { label: "源文件 SHA256", value: "4".repeat(64) },
  ]));
  expect(evidence.dataset.links).toEqual([
    expect.objectContaining({ label: "数据集引用", href: "https://doi.org/10.1039/C8SC04228D", type: "dataset" }),
  ]);
  expect(JSON.stringify(reaction)).toBe(before);
});

test("reader-fix dataset DOI links are explicit, deduplicated and never guessed from names or identifiers", () => {
  const name = "Stored https://doi.org/10.1039/C8SC04228D https://dx.doi.org/10.1039/C8SC04228D";
  expect(buildReactionEvidence({ reactionData: savedOrd(name) }).dataset.links).toHaveLength(1);
  const unlinked = buildReactionEvidence({ reactionData: savedOrd("Unlinked original dataset 10.1039/C8SC04228D") });
  expect(unlinked.dataset.links).toEqual([]);
  expect(unlinked.dataset.fields[0].value).toBe("Unlinked original dataset 10.1039/C8SC04228D");
  expect(unlinked.links).toEqual([]);
});

test.each([
  "javascript:https://doi.org/10.1039/C8SC04228D",
  "https://doi.org.evil.example/10.1039/C8SC04228D",
  "https://name:password@doi.org/10.1039/C8SC04228D",
  "https://doi.org/10.1039/C8SC04228D?redirect=https://evil.example",
  "https://doi.org/10.1039/C8SC04228D#untrusted",
  "https://doi.org/10.1039/C8SC04228D%0Aevil",
  "https://doi.org/10.1039/C8SC04228D%3Fredirect=untrusted",
  "https://doi.org/10.1039/C8SC04228D%23untrusted",
  "https://doi.org/10.1039/C8SC04228D%00untrusted",
  "https://evil.example/10.1039/C8SC04228D",
])("reader-fix dataset URL projection rejects unsafe or unsupported citations: %s", name => {
  const evidence = buildReactionEvidence({ reactionData: savedOrd(name) });
  expect(evidence.dataset.links).toEqual([]);
  expect(evidence.conditions).toEqual([]);
});

test.each([undefined, null, [], { source: "OTHER", dataset_name: "https://doi.org/10.1039/C8SC04228D" }])(
  "reader-fix missing or unrecognized dataset provenance cannot acquire a citation", provenance => {
    const evidence = buildReactionEvidence({ reactionData: { provenance } });
    expect(evidence.dataset).toBeNull();
    expect(evidence.links).toEqual([]);
    expect(evidence.conditions).toEqual([]);
  },
);

test("reader-fix ordinary evidence rejects unsafe explicit URLs without rewriting valid conditions", () => {
  const evidence = buildReactionEvidence({ reactionData: {
    reference_url: "javascript:alert(1)", solvent: "DCM", yield: 0,
  } });
  expect(evidence.links).toEqual([]);
  expect(evidence.conditions).toEqual([{ label: "溶剂", value: "DCM" }, { label: "收率", value: 0 }]);
});
