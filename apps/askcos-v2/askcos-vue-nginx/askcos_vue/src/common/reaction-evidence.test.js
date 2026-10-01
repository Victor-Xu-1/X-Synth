import {
  buildReactionEvidence,
  createConditionRecommendationUrl,
  createReactionEvidenceInput,
  createPatentLinks,
  normalizePatentNumber,
} from "@/common/reaction-evidence";

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
    "https://patents.google.com/patent/WO2024059806A1"
  );
  expect(evidence.links.map((link) => link.href)).toContain(
    "https://doi.org/10.1021/acs.joc.0c00000"
  );
  expect(evidence.links.map((link) => link.href)).toContain(
    "https://pubmed.ncbi.nlm.nih.gov/12345678/"
  );
  expect(evidence.fields).toEqual(
    expect.arrayContaining([
      { label: "参考反应", value: "CCO>>CC=O", kind: "reaction" },
      { label: "专利号", value: "WO2024/59806; A1", kind: "text" },
    ])
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
    "/forward?tab=context&rxnsmiles=CCO%3E%3ECC%3DO"
  );
});
