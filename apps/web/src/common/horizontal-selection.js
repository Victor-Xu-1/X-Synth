export function revealHorizontalSelection(container, target) {
  if (!container?.isConnected || !target?.isConnected || !container.contains(target) || !container.clientWidth) return;
  const bounds = container.getBoundingClientRect(), item = target.getBoundingClientRect();
  if (!item.width || !item.height) return;
  const left = bounds.left + container.clientLeft, right = left + container.clientWidth;
  const inset = Math.min(8, container.clientWidth / 4);
  let offset = 0;
  if (item.left < left + inset || item.width > container.clientWidth - inset * 2)
    offset = item.left - left - inset;
  else if (item.right > right - inset) offset = item.right - right + inset;
  if (offset) container.scrollLeft = Math.max(0, Math.min(
    container.scrollWidth - container.clientWidth, container.scrollLeft + offset,
  ));
}
