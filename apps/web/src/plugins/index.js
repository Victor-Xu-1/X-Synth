/**
 * plugins/index.js
 *
 * Automatically included in `./src/main.js`
 */

import { loadResultStore } from "./resultstoreloader";
import vuetify from "./vuetify";
import pinia from "../store";
import router from "../router";
import VueConfetti from "vue-confetti";
import VuetifyUseDialog from "vuetify-use-dialog";
import keycloakPlugin from "./keycloak";
import timeago from "vue-timeago3";
import zhCN from "date-fns/locale/zh-CN";
import { createGtag } from "vue-gtag";

export function registerPlugins(app) {
  // order is important
  app
    .use(vuetify)
    .use(pinia)
    .use(VueConfetti)
    .use(timeago, {
      locale: zhCN,
      defaultConverterOptions: {
        addSuffix: true,
      },
    })
    .use(VuetifyUseDialog, {
      confirmDialog: {
        title: "请确认",
        confirmationText: "确定",
        cancellationText: "取消",
      },
      snackbar: {
        closeButtonText: "关闭",
      },
    })
    .use(keycloakPlugin)
    .use(router)
    .use(
      createGtag({
        tagId: "",
        initMode: "manual",
        pageTracker: { router },
      })
    );
  loadResultStore();
}
