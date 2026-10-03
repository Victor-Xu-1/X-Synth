/** @jest-environment node */
import { graphFromCandidate } from "./route-graph";
import {
  feasibilityLocation,
  moleculeLocations,
  reactionForNode,
  stepForNode,
  templateTargets,
} from "./route-node-context";
import { safeExternalUrl } from "./external-url";

const route = {
  target_smiles: "CC(=O)NCCc1ccc(Br)cc1",
  steps: [
    {
      product: "CC(=O)NCCc1ccc(Br)cc1",
      precursors: ["CC(N)=O", "Cc1ccc(S(=O)(=O)OCCc2ccc(Br)cc2)cc1"],
      metadata: {
        model_metadata: [
          {
            model_name: "pistachio",
            source: {
              template: {
                _id: "7bc41b373203fc50b7bada7b31865f35",
                index: 3325,
                template_set: "pistachio",
              },
            },
          },
        ],
      },
    },
  ],
};

test("node reaction context follows actual graph edges and never source index alone", () => {
  const graph = graphFromCandidate(route);
  const reaction = reactionForNode(
    graph,
    graph.nodes.find((node) => node.id === "r-1"),
  );
  expect(reaction).toEqual({
    reactants: route.steps[0].precursors.join("."),
    product: route.target_smiles,
    smiles: route.steps[0].precursors.join(".") + ">>" + route.target_smiles,
  });
  expect(reactionForNode(graph, graph.nodes[0])).toBeNull();
  expect(
    reactionForNode({ nodes: [], edges: [] }, { id: "r-1", type: "reaction" }),
  ).toBeNull();
  expect(feasibilityLocation(reaction).query).toEqual({
    reactants: reaction.reactants,
    product: reaction.product,
  });
});

test("molecule handoffs are prefill locations, retaining structure and snapshot without submission", () => {
  const locations = moleculeLocations("CC(N)=O", "snapshot-id");
  expect(locations.stock).toEqual({
    path: "/buyables",
    query: { smiles: "CC(N)=O", snapshot: "snapshot-id" },
  });
  expect(locations.retro.query).toEqual({ smiles: "CC(N)=O", mode: "manual" });
  expect(moleculeLocations("")).toEqual({});
});

test("template namespaces survive drill-through and are not invented from missing IDs", () => {
  const before = JSON.stringify(route);
  expect(stepForNode(route, "r-1")).toBe(route.steps[0]);
  expect(stepForNode(route, "r-100")).toBeNull();
  expect(stepForNode(route, "r-../../bad")).toBeNull();
  expect(templateTargets(route.steps[0])[0].location).toEqual({
    path: "/template",
    query: {
      source: "pistachio",
      id: "pistachio:7bc41b373203fc50b7bada7b31865f35",
    },
  });
  expect(
    templateTargets({
      metadata: { model_metadata: [{ source: { template: { index: 0 } } }] },
    }),
  ).toEqual([]);
  expect(
    templateTargets({
      metadata: {
        model_metadata: [
          {
            source: {
              template: { _id: "unsafe", template_set: "bad namespace" },
            },
          },
        ],
      },
    }),
  ).toEqual([]);
  expect(JSON.stringify(route)).toBe(before);
});

test("catalog and evidence links reject executable schemes and embedded credentials", () => {
  expect(safeExternalUrl("https://mcule.com/MCULE-9280264861")).toBe(
    "https://mcule.com/MCULE-9280264861",
  );
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "//example.com",
    "https://user:secret@example.com",
    null,
    {},
  ])
    expect(safeExternalUrl(value)).toBeNull();
});
