/**
 * plugins/index.js
 *
 * Automatically included in `./src/main.js`
 */

import vuetify from "./vuetify";
import pinia from "../store";
import router from "../router";
import VuetifyUseDialog from "vuetify-use-dialog";
import keycloakPlugin from "./keycloak";
import timeago from "vue-timeago3";
import enUS from "date-fns/locale/en-US";
import { createGtag } from "vue-gtag";
import language, { initializeLocale } from "@/i18n";

export function registerPlugins(app) {
  initializeLocale();
  // order is important
  app
    .use(language)
    .use(vuetify)
    .use(pinia)
    .use(timeago, {
      locale: enUS,
      defaultConverterOptions: {
        addSuffix: true,
      },
    })
    .use(VuetifyUseDialog)
    .use(keycloakPlugin)
    .use(router)
    .use(
      createGtag({
        tagId: "",
        initMode: "manual",
        pageTracker: { router },
      }),
    );
}
