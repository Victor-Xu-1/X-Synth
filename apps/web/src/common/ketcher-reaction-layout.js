const roles = ["reactants", "products", "agents"];
const invalid = () => { throw new Error(JSON.stringify({ detail: "初始反应排布不能保持完整角色或结构身份。" })); };
const finite = value => typeof value === "number" && Number.isFinite(value);
const point = value => Array.isArray(value) && value.length === 3 && value.every(finite);

function bounds(molecule) {
  if (molecule?.type !== "molecule" || !Array.isArray(molecule.atoms) || !molecule.atoms.length) invalid();
  const coordinates = molecule.atoms.map(atom => atom.location);
  if (!coordinates.every(point)) invalid();
  const xs = coordinates.map(value => value[0]), ys = coordinates.map(value => value[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) };
}

function translate(molecule, dx, dy) {
  for (const atom of molecule.atoms) { atom.location[0] += dx; atom.location[1] += dy; }
  if (molecule.stereoFlagPosition) {
    const position = molecule.stereoFlagPosition;
    if (![position.x, position.y, position.z].every(finite)) invalid();
    // This 2.13 field uses native screen-y, unlike KET atom locations.
    position.x += dx;
    position.y -= dy;
  }
}

// Initial RXN imports in the bundled 2.13 serializer retain R/P/A component order.
// Counts come from the validated draft; the caller must verify every role after import.
export function compactInitialReaction(document, records, viewport = { width: 800, height: 432 }) {
  if (!records || !roles.every(role => Array.isArray(records[role]))) invalid();
  const counts = Object.fromEntries(roles.map(role => [role, records[role].reduce((total, record) => {
    if (!Number.isSafeInteger(record.components) || record.components < 1) invalid();
    return total + record.components;
  }, 0)]));
  if (counts.agents < 4 || !counts.reactants || !counts.products) return null;
  const result = structuredClone(document), nodes = result?.root?.nodes;
  if (!Array.isArray(nodes)) invalid();
  const references = nodes.filter(node => typeof node?.$ref === "string");
  if (references.length !== counts.reactants + counts.products + counts.agents
    || new Set(references.map(node => node.$ref)).size !== references.length) invalid();
  const molecules = references.map(node => result[node.$ref]);
  molecules.forEach(bounds);
  // Generated RXN input has no free-form user annotations; never relocate unknown objects.
  if (nodes.some(node => !node.$ref && !["arrow", "plus"].includes(node.type))) invalid();
  const arrows = nodes.filter(node => node.type === "arrow");
  if (arrows.length !== 1) invalid();
  const positions = arrows[0].data?.pos;
  if (!Array.isArray(positions) || positions.length !== 2
    || !positions.every(value => value && [value.x, value.y, value.z].every(finite))
    || positions[0].y !== positions[1].y || positions[1].x <= positions[0].x) invalid();
  const agents = molecules.slice(counts.reactants + counts.products);
  const products = molecules.slice(counts.reactants, counts.reactants + counts.products);
  const gap = 1.5;
  const left = positions[0].x + gap, oldEnd = positions[1].x;
  const area = finite(viewport?.width) && viewport.width > 64 && finite(viewport.height) && viewport.height > 64
    ? viewport : { width: 800, height: 432 };
  const boxes = agents.map(bounds), primary = molecules.slice(0, counts.reactants + counts.products).map(bounds);
  const candidates = Array.from({ length: Math.min(4, agents.length) }, (_, index) => {
    const columns = index + 1, widths = Array(columns).fill(1), heights = [];
    boxes.forEach((box, index) => {
      widths[index % columns] = Math.max(widths[index % columns], box.right - box.left);
      const row = Math.floor(index / columns);
      heights[row] = Math.max(heights[row] || 1, box.top - box.bottom);
    });
    const end = left + widths.reduce((sum, width) => sum + width, 0) + gap * columns;
    const right = Math.max(...primary.map((box, index) => box.right + (index >= counts.reactants ? end - oldEnd : 0)));
    const width = right - Math.min(...primary.map(box => box.left));
    const height = Math.max(...primary.map(box => box.top), positions[0].y + 3
      + heights.reduce((sum, height) => sum + height, 0) + gap * (heights.length - 1))
      - Math.min(...primary.map(box => box.bottom));
    return { columns, widths, end, score: Math.max(width / (area.width - 64), height / (area.height - 64)) };
  });
  const grid = candidates.reduce((best, candidate) => candidate.score < best.score ? candidate : best);
  const newEnd = grid.end;
  let bottom = positions[0].y + 3;
  for (let index = 0; index < agents.length; index += grid.columns) {
    const row = agents.slice(index, index + grid.columns);
    const height = Math.max(...row.map(mol => { const box = bounds(mol); return Math.max(1, box.top - box.bottom); }));
    let columnLeft = left;
    row.forEach((molecule, column) => {
      const box = bounds(molecule);
      translate(molecule, columnLeft - box.left, bottom - box.bottom);
      columnLeft += grid.widths[column] + gap;
    });
    bottom += height + gap;
  }
  positions[1].x = newEnd;
  products.forEach(molecule => translate(molecule, newEnd - oldEnd, 0));
  for (const node of nodes) {
    if (node.type !== "plus") continue;
    if (!point(node.location)) invalid();
    if (node.location[0] > oldEnd) node.location[0] += newEnd - oldEnd;
  }
  return result;
}

export function requireSameReactionRoles(expected, actual) {
  if (!roles.every(role => Array.isArray(expected?.[role]) && Array.isArray(actual?.[role]))) invalid();
  for (const role of roles) {
    const identities = value => value[role].map(record => {
      if (typeof record.smiles !== "string" || !record.smiles) invalid();
      return record.smiles;
    }).sort();
    if (JSON.stringify(identities(expected)) !== JSON.stringify(identities(actual))) invalid();
  }
}
