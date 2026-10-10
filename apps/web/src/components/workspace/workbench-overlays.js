export function workbenchMenuProps(active, target) {
  const suspended = !active || !target;
  // Active widgets retain their own disabled/empty state and presentation model.
  return { attach: target, ...(suspended ? { disabled: true, modelValue: false } : {}) };
}

export function workbenchOverlayDefaults(active, target) {
  const menu = workbenchMenuProps(active, target);
  return { VMenu: menu, VTooltip: menu, VSelect: { menuProps: menu },
    VAutocomplete: { menuProps: menu }, VCombobox: { menuProps: menu } };
}
