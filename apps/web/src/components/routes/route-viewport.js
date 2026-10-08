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
  let active = true, pending = null, lastSize = null, focusOptions = null, duration = 0;
  function schedule(animation = 0, explicit = false) {
    if (!active) return Promise.resolve();
    if (explicit || !pending) duration = animation;
    if (!pending) pending = nextTick().then(() => {
      pending = null;
      if (!active) return;
      const bounds = surface.value?.getBoundingClientRect();
      if (bounds?.width > 0 && bounds.height > 0) return fitView({ ...options(), ...focusOptions, duration });
    });
    return pending;
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
  onScopeDispose(() => { active = false; });
  return { fit, focus };
}
