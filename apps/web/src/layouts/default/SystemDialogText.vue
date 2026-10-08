<script>
import { defineComponent, h, resolveComponent } from "vue";
import { uiText } from "@/i18n";
import SystemConfirmActions from "./SystemConfirmActions.vue";

const SystemDialogText = defineComponent({ props: {
  source: { type: String, required: true }, values: { type: Object, default: () => ({}) },
  heading: Boolean, id: String,
}, setup(props) {
  return () => props.heading
    ? h(resolveComponent("VCardTitle"), { id: props.id, style: { whiteSpace: "normal", overflowWrap: "anywhere" } },
      () => uiText(props.source, props.values))
    : h("span", uiText(props.source, props.values));
} });
let nextId = 0;
export function systemConfirm(title, content, values = {}, dialogProps = {}) {
  const id = `system-confirm-${++nextId}`;
  return {
    title: uiText(title, values), content: uiText(content, values),
    titleComponent: SystemDialogText, titleComponentProps: { source: title, values, heading: true, id },
    contentComponent: SystemDialogText, contentComponentProps: { source: content, values },
    actionsContentComponent: SystemConfirmActions,
    confirmationText: uiText("确定"), cancellationText: uiText("取消"),
    dialogProps: { ...dialogProps, "aria-labelledby": id },
  };
}
export default SystemDialogText;
</script>
