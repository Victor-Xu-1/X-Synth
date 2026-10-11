import { nextTick, onScopeDispose } from "vue";
import { useResizeObserver } from "@vueuse/core";

export function previewAspectRatio(graph, nodeSize) {
  if (!graph.nodes.length) return 1.5;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of graph.nodes) {
    const size = nodeSize[node.type], position = node.position;
    if (!size || !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return 1.5;
    left = Math.min(left, position.x);
    top = Math.min(top, position.y);
    right = Math.max(right, position.x + size.width);
    bottom = Math.max(bottom, position.y + size.height);
  }
  return (right - left) / (bottom - top);
}

export function useRouteViewport(surface, fitView, options) {
  let active = true, pending = null, running = null, lastSize = null, focusOptions = null, duration = 0;
  function operation() {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject, intent: null };
  }
  function schedule(animation = 0, explicit = false) {
    if (!active) return Promise.resolve(false);
    if (explicit || !pending) duration = animation;
    if (!pending) {
      const work = operation();
      pending = work;
      nextTick().then(() => {
        if (pending !== work) return;
        pending = null;
        work.intent = focusOptions;
        const previous = running;
        running = work;
        // Native interrupted animations may never settle. The latest matching intent completes their callers.
        if (previous) {
          if (previous.intent === work.intent) work.promise.then(previous.resolve, previous.reject);
          else previous.resolve(false);
        }
        const bounds = surface.value?.getBoundingClientRect();
        if (!active || !(bounds?.width > 0 && bounds.height > 0)) {
          running = null; work.resolve(false); return;
        }
        try {
          Promise.resolve(fitView({ ...options(), ...focusOptions, duration })).then(value => {
            if (running !== work) return;
            running = null; work.resolve(value !== false);
          }, error => {
            if (running !== work) return;
            running = null; work.reject(error);
          });
        } catch (error) { running = null; work.reject(error); }
      });
    }
    return pending.promise;
  }
  function fit() {
    focusOptions = null;
    return schedule(0, true);
  }
  function focus(nodes, settings) {
    focusOptions = { ...settings, nodes: [...nodes] };
    return schedule(settings.duration ?? 0, true);
  }
  useResizeObserver(surface, ([entry]) => {
    const bounds = entry?.contentRect;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      lastSize = null;
      return;
    }
    const size = `${bounds.width}:${bounds.height}`;
    if (size === lastSize) return;
    lastSize = size;
    schedule();
  });
  onScopeDispose(() => {
    active = false; pending?.resolve(false); running?.resolve(false); pending = null; running = null;
  });
  return { fit, focus };
}
