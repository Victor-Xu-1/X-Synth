function releaseParts(value) {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d{0,5})\.([0-9])\.(0|[1-9]\d?)$/.exec(value);
  return match?.[0] === value ? match.slice(1).map(Number) : null;
}

export function newerWorkspaceVersion(loaded, running) {
  const previous = releaseParts(loaded), current = releaseParts(running);
  if (!previous || !current) return null;
  const different = current.findIndex((part, index) => part !== previous[index]);
  return different >= 0 && current[different] > previous[different] ? running : null;
}
