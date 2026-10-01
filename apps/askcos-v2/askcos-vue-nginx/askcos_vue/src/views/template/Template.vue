<template>
  <module-workbench
    title="模板信息工作台"
    eyebrow="反应模板"
    icon="mdi-file-document-search-outline"
    accent="purple"
    description="查看反应模板 SMARTS、模板集合、引用数量和对应反应记录，并支持 Reaxys / CAS 相关引用导出。"
    :summary-items="summaryItems"
  >
    <v-row class="justify-center">
      <v-col cols="12" md="12" xl="10">
        <v-sheet elevation="2" rounded="lg" class="pa-5">
          <v-row class="justify-center">
            <v-table class="mt-2" col="12">
              <tbody>
                <tr>
                  <th>反应模板：</th>
                  <td>
                    <span class="smiles">{{
                      templateInfo["reaction_smarts"]
                    }}</span>
                  </td>
                </tr>
                <tr>
                  <th>模板集合：</th>
                  <td>{{ templateInfo["template_set"] }}</td>
                </tr>
                <tr>
                  <th>引用总数：</th>
                  <td>{{ templateInfo.count }}</td>
                </tr>
              </tbody>
            </v-table>
            <v-col cols="12" sm="8" md="10">
              <copy-tooltip :data="templateInfo['reaction_smarts']">
                <smiles-image v-if="!!templateInfo['reaction_smarts']" :smiles="templateInfo['reaction_smarts']"
                  input-type="template"></smiles-image>
              </copy-tooltip>
            </v-col>
            <v-col col="12" sm="8" md="10" v-if="templateInfo['necessary_reagent']">
              <p v-if="templateInfo['necessary_reagent']">
                <em>
                  注意：该反应需要试剂贡献
                  {{ templateInfo["necessary_reagent"] }}
                </em>
              </p>
              <p v-if="templateInfo['intra_only']">
                <em>
                  注意：该模板<b>仅</b>适用于分子内反应
                </em>
              </p>
              <p v-if="templateInfo['dimer_only']">
                <em>
                  注意：该模板<b>仅</b>适用于对称二聚反应
                </em>
              </p>
            </v-col>

            <v-col cols="12" sm="8" md="10" class="mb-3">
              <v-row class="d-flex flex-row align-center justify-space-between">
                <div>
                  <copy-tooltip class="btn btn-outline-secondary" :data="allReactionReferences" no-highlight>
                    <v-btn variant="outlined" class="flex-1-0">复制全部反应 ID</v-btn>
                  </copy-tooltip>
                </div>
                <div>
                  <v-btn v-if="templateInfo.template_set === 'reaxys'" variant="outlined"
                    @click="downloadReactionQuery">
                    导出全部反应 ID 为 Reaxys 查询
                  </v-btn>
                </div>
                <div>
                  <v-btn v-if="templateInfo.template_set === 'reaxys'" variant="outlined" :href="rexaysURL"
                    target="_blank">
                    在 Reaxys 中查找当前页反应
                  </v-btn>
                </div>

                <template v-if="templateInfo.template_set === 'cas' &&
                      rxnListItems &&
                      rxnListItems.length
                      ">
                  <sci-findern-button class="ml-2" @click="casSearch"></sci-findern-button>
                  <v-menu location="bottom" :close-on-content-click="false" id="proxy-settings">
                    <template v-slot:activator="{ props }">
                      <v-btn color="primary" dark v-bind="props">
                        代理设置
                      </v-btn>
                    </template>
                    <v-card style="width: 18rem">
                      <v-card-text>
                        <span>
                          如果你的机构访问 SciFinder<sup>n</sup> 需要代理，请在下方输入代理地址：</span>
                        <v-text-field label="代理 URL" variant="outlined" v-model="proxyUrl"
                          hide-details></v-text-field>
                      </v-card-text>
                      <v-card-actions>
                        <v-btn class="ml-2" variant="primary" type="submit" @click="saveProxyUrl">保存</v-btn>
                      </v-card-actions>
                    </v-card>
                  </v-menu>
                </template>
              </v-row>
            </v-col>
          </v-row>
        </v-sheet>
      </v-col>
    </v-row>

    <v-row class="justify-center">
      <v-col cols="12" md="12" xl="10">
        <v-sheet elevation="2" class="d-flex justify-center align-center pa-5" rounded="lg">
          <v-row class="justify-center">
            <v-col cols="12">
              <v-data-table :headers="headers" :items="rxnListItems" :loading="loading"
                :no-data-text="'反应数据不可用。'" class="pa-2">
                <template #item.reaction_id="{ item }">
                  {{ item.reaction_id }}
                  <smiles-image v-if="item.reaction_smiles" :smiles="item.reaction_smiles" input-type="reaction" />
                </template>
                <template #item.spectators="{ item }">
                  {{ item.spectators }}
                </template>
                <template #item.reference="{ item }">
                  <template v-if="item.reference_url">
                    <a v-if="item.reference" :href="item.reference_url" target="_blank">
                      {{ item.reference }}
                    </a>
                    <a v-else :href="item.reference_url" target="_blank">
                      链接
                    </a>
                  </template>
                  <template v-else>
                    {{ item.reference }}
                  </template>
                </template>
              </v-data-table>
            </v-col>

            <v-col cols="12">
              <v-row align="center" justify="space-between" class="mx-auto my-3">
                <v-expansion-panels multiple density="compact">
                  <v-expansion-panel density="compact">
                    <template v-slot:title>
                      <span class="text-body-1 ml-2">
                        <b>反应引用 ID： </b></span>
                    </template>
                    <template v-slot:text>
                      <v-row>
                        <v-col>
                          <copy-tooltip :data="allReactionReferences">
                            <span>{{ allReactionReferences }}</span>
                          </copy-tooltip>
                        </v-col>
                      </v-row>
                    </template>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-row>
            </v-col>
          </v-row>
        </v-sheet>
      </v-col>
    </v-row>
  </module-workbench>
</template>

<script>
import { ref, reactive, onMounted, computed, watch } from "vue";
import CopyTooltip from "@/components/CopyTooltip";
import SciFindernButton from "@/components/SciFindernButton";
import SmilesImage from "@/components/SmilesImage";
import { API } from "@/common/api";
import { createReaxysQuery, createReaxysUrl } from "@/common/reaxys";
import { createCasClient } from "@/common/cas-client";
import { storageAvailable } from "@/common/utils";
import { saveAs } from "file-saver";
import ModuleWorkbench from "@/components/ModuleWorkbench.vue";
import { useConfigStore } from "@/store/config";

const PROXY_STORAGE_KEY = "casProxyUrl";

export default {
  name: "App",
  components: {
    CopyTooltip,
    SciFindernButton,
    SmilesImage,
    ModuleWorkbench,
  },
  setup() {
    const casClient = ref(null);
    const casUser = ref(null);
    const casUrl = ref(null);
    const proxyUrl = ref("");
    const templateId = ref(null);
    const templateInfo = ref({});
    const reactionsByPage = reactive({});
    const rxnListCurrentPage = ref(1);
    const rxnListItemsPerPage = ref(50);
    const loading = ref(false);
    const configStore = useConfigStore();
    const summaryItems = [
      { label: "模板", value: "Reaction SMARTS 与集合信息", icon: "mdi-code-braces" },
      { label: "引用", value: "Reaxys / CAS / USPTO / Pistachio", icon: "mdi-book-open-variant" },
      { label: "导出", value: "复制 ID 或导出 Reaxys 查询", icon: "mdi-download-outline" },
    ];

    const headers = ref([
      { key: "reaction_id", title: "反应 ID" },
      { key: "rxnid", title: "反应" },
      { key: "spectators", title: "旁观物" },
      { key: "reference", title: "引用" },
    ]);

    const lookupTemplate = async () => {
      if (templateId.value) {
        loading.value = true;
        try {
          const json = await API.get("/api/template/retrieve", {
            pk: templateId.value,
          });
          templateInfo.value = json.template;
          await lookupReactions();
        } catch (error) {
          console.error("Error fetching template:", error);
        } finally {
          loading.value = false;
        }
      }
    };

    const lookupReactions = async () => {
      loading.value = true;
      const json = await API.post("/api/reactions/post", {
        template_set: templateInfo.value.template_set,
        ids: currentReactionReferences.value,
      });
      let reactions = generateReferences(
        json.reactions,
        currentReactionReferences.value
      );
      reactionsByPage[rxnListCurrentPage.value] = reactions;
      loading.value = false;
    };

    const downloadReactionQuery = () => {
      let blob = new Blob([createReaxysQuery(templateInfo.value.references)], {
        type: "data:text/json;charset=utf-8",
      });
      saveAs(blob, "reaxys_query.json");
    };

    const generateReferences = (reactions, reactionIds) => {
      if (templateInfo.value.template_set.startsWith("reaxys")) {
        return generateReaxysReferences(reactions, reactionIds);
      } else if (
        templateInfo.value.template_set.startsWith("pistachio") ||
        templateInfo.value.template_set.startsWith("uspto")
      ) {
        return generatePistachioReferences(reactions);
      } else {
        return reactions;
      }
    };

    const generateReaxysReferences = (reactions, reactionIds) => {
      if (reactions.length) {
        return reactions.map((r) => {
          return {
            reference_url: createReaxysUrl([r["reaction_id"]]),
            ...r,
          };
        });
      } else {
        return reactionIds.map((rid) => {
          return {
            reaction_id: rid,
            reference_url: createReaxysUrl([rid]),
          };
        });
      }
    };

    const generatePistachioReferences = (reactions) => {
      return reactions.map((r) => {
        return {
          reference: r.title.includes("_")
            ? r.title.replace("_", " [") + "]"
            : r.title,
          reference_url: createPistachioUrl(r.title),
          ...r,
        };
      });
    };

    const createPistachioUrl = (pid) => {
      if (configStore.envs.VITE_PISTACHIO_WEB_URL) {
        return `${configStore.envs.VITE_PISTACHIO_WEB_URL}/#search/${pid}//p1`;
      }

      return `https://patents.google.com/patent/${pid.split("_")[0]}/`;
    };

    const casLogin = () => {
      return casClient.value
        .login()
        .then((user) => {
          console.log("Logged in!");
          casUser.value = user;
        })
        .catch((err) => {
          console.log("Could not login: ", err);
        });
    };

    const createCasUrl = () => {
      if (!casUser.value || casUser.value.expired || !rxnListItems.value) {
        return;
      }
      const data = {
        uriList: rxnListItems.value.map((rxn) => `reaction/pt/${rxn["rxnid"]}`),
      };
      return casClient.value
        .post("/api/v1/import/reactions", data)
        .then((json) => {
          const host = proxyUrl.value || casClient.value.apiServer;
          casUrl.value = host + json.path;
        })
        .catch((err) => {
          console.log("Could not import reactions: ", err);
          alert("无法使用 SciFinder API 导入反应。");
        });
    };

    const casSearch = () => {
      if (!rxnListItems.value) {
        return;
      }
      if (casUrl.value) {
        window.open(casUrl.value, "_blank");
      } else if (!casUser.value || casUser.value.expired) {
        casLogin()
          .then(() => {
            return createCasUrl();
          })
          .then(() => {
            if (casUrl.value) {
              // Open in current window because popup will be blocked
              window.location = casUrl.value;
            }
          });
      } else {
        createCasUrl().then(() => {
          if (casUrl.value) {
            // Open in current window because popup will be blocked
            window.location = casUrl.value;
          }
        });
      }
    };

    const initializeCasClient = () => {
      return createCasClient({}, proxyUrl.value)
        .then((client) => {
          casClient.value = client;
          return casClient.value.getUser();
        })
        .then((user) => {
          casUser.value = user;
        });
    };

    const saveProxyUrl = () => {
      if (storageAvailable("localStorage")) {
        localStorage.setItem(
          PROXY_STORAGE_KEY,
          encodeURIComponent(proxyUrl.value)
        );
      }
      initializeCasClient();
    };

    // const context = JSON.parse(document.getElementById('django-context').textContent);

    const allReactionReferences = computed(() => {
      // Returns all reaction references as a semicolon delimited string
      if (!!templateInfo.value && !!templateInfo.value.references) {
        return templateInfo.value.references.join("; ");
      } else {
        return "";
      }
    });

    const currentReactionReferences = computed(() => {
      // Returns reaction references for the current page as an array
      if (!!templateInfo.value && !!templateInfo.value.references) {
        const start =
          (rxnListCurrentPage.value - 1) * rxnListItemsPerPage.value;
        const end = start + rxnListItemsPerPage.value;
        return templateInfo.value.references.slice(start, end);
      } else {
        return [];
      }
    });

    const rxnListItems = computed(() => {
      return reactionsByPage[rxnListCurrentPage.value];
    });

    const rxnListTotalItems = computed(() => {
      if (!!templateInfo.value && !!templateInfo.value.references) {
        return templateInfo.value.references.length;
      } else {
        return 0;
      }
    });

    const rexaysURL = computed(() => {
      return createReaxysUrl(currentReactionReferences.value);
    });

    onMounted(async () => {
      const urlParams = new URLSearchParams(window.location.search);
      templateId.value = urlParams.get("id");
      const lookupPromise = await lookupTemplate();
      if (storageAvailable("localStorage")) {
        const value = localStorage.getItem(PROXY_STORAGE_KEY);
        if (value) {
          proxyUrl.value = decodeURIComponent(value);
        }
      }

      const authPromise = initializeCasClient();

      Promise.all([lookupPromise, authPromise]).then(() => {
        createCasUrl();
      });
    });

    watch(rxnListCurrentPage, (newVal) => {
      if (reactionsByPage[newVal] === undefined) {
        lookupReactions().then(() => {
          createCasUrl();
        });
      }
    });

    return {
      casClient,
      casUser,
      casUrl,
      proxyUrl,
      templateId,
      templateInfo,
      reactionsByPage,
      rxnListCurrentPage,
      rxnListItemsPerPage,
      loading,
      summaryItems,
      allReactionReferences,
      currentReactionReferences,
      rexaysURL,
      rxnListItems,
      rxnListTotalItems,
      headers,
      lookupTemplate,
      lookupReactions,
      downloadReactionQuery,
      generateReferences,
      generateReaxysReferences,
      generatePistachioReferences,
      createPistachioUrl,
      casLogin,
      createCasUrl,
      casSearch,
      initializeCasClient,
      saveProxyUrl,
      configStore,
    };
  },
};
</script>
