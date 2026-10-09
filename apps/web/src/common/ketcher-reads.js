import { readonly, ref } from "vue";

export function createKetcherReadQueue() {
  const pending = ref(0);
  const owners = new Set();
  let epoch = 0, queue = Promise.resolve();

  function invalidate() {
    epoch++;
    for (const retire of owners) retire();
    owners.clear();
    pending.value = 0;
    queue = Promise.resolve();
  }

  function enqueue(read) {
    const requested = epoch;
    const current = () => requested === epoch;
    const run = async () => {
      if (!current()) return null;
      pending.value++;
      let retire;
      const retired = new Promise(resolve => { retire = () => resolve(null); });
      owners.add(retire);
      // Retire host ownership, not the native export; its late result remains observed.
      try { return await Promise.race([read(current), retired]); }
      finally {
        owners.delete(retire);
        if (current()) pending.value--;
      }
    };
    queue = queue.then(run, run);
    return queue;
  }

  return { pending: readonly(pending), enqueue, invalidate };
}
