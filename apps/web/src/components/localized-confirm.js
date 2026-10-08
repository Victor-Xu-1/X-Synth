import { uiText } from "@/i18n";
import LocalizedDialogText from "./LocalizedDialogText.vue";
import LocalizedConfirmActions from "./LocalizedConfirmActions.vue";

let nextId = 0;
export function localizedConfirm(title, content, values = {}, dialogProps = {}) {
  const id = `localized-confirm-${++nextId}`;
  return {
    title: uiText(title, values), content: uiText(content, values),
    titleComponent: LocalizedDialogText, titleComponentProps: { source: title, values, heading: true, id },
    contentComponent: LocalizedDialogText, contentComponentProps: { source: content, values },
    actionsContentComponent: LocalizedConfirmActions,
    confirmationText: uiText("确定"), cancellationText: uiText("取消"),
    dialogProps: { ...dialogProps, "aria-labelledby": id },
  };
}
