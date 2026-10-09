import { ref } from "vue";
const queues = new WeakMap();

function state(editor) {
  if (!queues.has(editor)) queues.set(editor, { pending: ref(0), queue: Promise.resolve() });
  return queues.get(editor);
}

export function ketcherNativeBusy(editor) {
  return !!editor && state(editor).pending.value > 0;
}

export function runKetcherOperation(editor, operation, current = () => true) {
  const owner = state(editor);
  const run = async () => {
    if (!current()) return null;
    owner.pending.value++;
    try { return await operation(); }
    finally { owner.pending.value--; }
  };
  const result = owner.queue.then(run, run);
  owner.queue = result.then(() => undefined, () => undefined);
  return result;
}
