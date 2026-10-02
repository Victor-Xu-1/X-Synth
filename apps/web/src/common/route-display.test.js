import { routeLeafNodes, reactionScoreLabel, routeLinearDepth } from "./route-display";

test("every leaf is retained, including branches outside the main chain", () => {
  const nodes = [{id:"target",type:"chemical",smiles:"product"},
    {id:"rxn",type:"reaction"}, {id:"left",type:"chemical",smiles:"CCO"},
    {id:"right",type:"chemical",smiles:"CCN"}];
  const edges = [{from:"target",to:"rxn"},{from:"rxn",to:"left"},{from:"rxn",to:"right"}];
  expect(routeLeafNodes({nodes,edges}).map(node => node.smiles)).toEqual(["CCO","CCN"]);
});

test("model scores are identified, never presented as reaction yields", () => {
  expect(reactionScoreLabel({ffScore:0.981})).toBe("FF 0.98");
  expect(reactionScoreLabel({retroScore:0.25})).toBe("模板 0.25");
  expect(reactionScoreLabel({ffScore:null})).toBe("反应");
});

test("linear length is a path length, not total branched reaction count", () => {
  const nodes = [{id:"root",type:"chemical"},{id:"r1",type:"reaction"},
    {id:"a",type:"chemical"},{id:"b",type:"chemical"},
    {id:"r2",type:"reaction"},{id:"r3",type:"reaction"}];
  const edges = [{from:"root",to:"r1"},{from:"r1",to:"a"},{from:"r1",to:"b"},
    {from:"a",to:"r2"},{from:"b",to:"r3"}];
  expect(routeLinearDepth({nodes,edges})).toBe(2);
  expect(routeLinearDepth({nodes,edges:[...edges,{from:"r2",to:"root"}]})).toBeNull();
});
