import { defineComponent, h } from "vue";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";
import { iconPaths } from "./icons-catalog.js";

export function resolveIconPath(name) {
  if (!Object.hasOwn(iconPaths, name)) {
    throw new Error(`Unregistered workspace icon: ${String(name)}`);
  }
  return iconPaths[name];
}

const WorkspaceMdiIcon = defineComponent({
  name: "WorkspaceMdiIcon",
  inheritAttrs: false,
  props: mdi.component.props,
  setup(props, { attrs }) {
    return () => h(mdi.component, {
      ...attrs,
      tag: props.tag,
      icon: resolveIconPath(props.icon),
      "data-workspace-icon": props.icon,
    });
  },
});

export const workspaceIcons = {
  defaultSet: "mdi",
  aliases,
  sets: { mdi: { component: WorkspaceMdiIcon } },
};
