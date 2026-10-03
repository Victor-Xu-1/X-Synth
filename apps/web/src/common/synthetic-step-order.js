// Ordering changes presentation only; engine indices and evidence stay intact.
export function syntheticStepOrder(steps = []) {
  const producers = new Map();
  for (const [index, step] of steps.entries()) {
    if (producers.has(step.product)) return null;
    producers.set(step.product, index);
  }
  const dependencies = steps.map(
    (step) =>
      new Set(
        (step.precursors || [])
          .filter((smiles) => producers.has(smiles))
          .map((smiles) => producers.get(smiles)),
      ),
  );
  const emitted = new Set(),
    order = [];
  while (order.length < steps.length) {
    const next = dependencies.findIndex(
      (parents, index) =>
        !emitted.has(index) &&
        [...parents].every((parent) => emitted.has(parent)),
    );
    if (next < 0) return null;
    emitted.add(next);
    order.push(next);
  }
  return order;
}
