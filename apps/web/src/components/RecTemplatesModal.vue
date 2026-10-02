<template>
  <v-dialog v-model="propShow" @update:model-value="openRecTemplatesModal" scrollable>
    <v-card>
      <v-card-title>
        推荐模板
      </v-card-title>
      <v-divider></v-divider>
      <v-card-text class="pa-0">
        <v-col cols="12" class="text-center pa-0">
          <h3>当前目标</h3>
        </v-col>
        <v-col cols="12" align="center" justify="center" class="pa-0">
          <smiles-image class="align-center justify-center" :smiles="selected.smiles" max-width="300px"></smiles-image>
        </v-col>
        <v-data-table ref="rtmTable" :headers="rtmFields" :items="rtmItems" density="compact">
          <template #item.reaction_smarts="{ item }">
            <smiles-image :smiles="item.reaction_smarts" input-type="template" highlight allow-copy></smiles-image>
            <a :href="`/template?id=${item._id}`" target="_blank">{{ item._id }} ({{ item.template_set
            }})</a>
          </template>
          <template #item.rank="{ item }">
            {{ item.template_rank }}
          </template>
          <template #item.score="{ item }">
            {{ item.template_score.toFixed(4) }}
          </template>
          <template #item.p_index="{ }">
            1
          </template>
          <template #item.results="{ item }">
            <template v-if="item.results !== undefined">
              <template v-if="item.results[0]">
                <smiles-image :smiles="item.results[0]" transparent
                  :data-cy="'recom-template-smiles-' + (item.results[0])"></smiles-image>
              </template>
              <template v-else><span :data-cy="'recom-template-no-prec-' + (item.template_rank)">无前体</span></template>
            </template>
            <template v-else>
              <v-menu location="bottom">
                <template v-slot:activator="{ props }">
                  <v-btn color="primary" dark v-bind="props"
                    :data-cy="'recom-template-apply-template-' + (item.template_rank)">
                    应用模板
                  </v-btn>
                </template>
                <v-list>
                  <v-list-item v-for="(templateSet, index) in templateSetsList" :key="index">
                    <v-btn variant="tonal"
                      :data-cy="'recom-template-apply-template-' + (item.template_rank) + '-' + (templateSet)"
                      @click="apply(selected.smiles, item, templateSet)">{{ templateSet }}</v-btn>
                  </v-list-item>
                </v-list>
              </v-menu>
            </template>
          </template>
        </v-data-table>
      </v-card-text>
      <v-divider></v-divider>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn @click="close()" variant="tonal" data-cy="recom-template-close">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import { ref, computed, watch } from "vue";
import SmilesImage from "@/components/SmilesImage";
import { useResultsStore } from "@/store/results";
import { API } from "@/common/api";

export default {
  name: "RecTemplatesModal",
  components: {
    SmilesImage,
  },
  props: {
    selected: {
      type: Object,
      default: () => ({}),
    },
    visible: {
      type: Boolean,
      default: false,
    },
    selectedTemplate: {
      type: String,
      default: "reaxys"
    },
    templateSets: {
      type: Object,
      default: () => ({}),
    }
  },
  setup(props, context) {
    const resultsStore = useResultsStore();
    const rtmFields = ref([
      { key: "rank", title: "原始排序", align: 'center', width: '10%' },
      { key: "score", title: "得分", align: 'center', width: '10%' },
      { key: "p_index", title: "优先级模型", align: 'center', width: '10%' },
      { key: "reaction_smarts", title: "模板", align: 'center', width: '70%' },
      { key: "results", title: "结果", align: 'center' },
    ]);
    const rtmItemsPerPage = ref(20);
    const rtmCurrentPage = ref(1);
    const loading = ref(false);
    const applyingTemplate = ref(null);
    const rtmTable = ref(null);
    const templateSetsList = ref([]);

    const rtmItems = computed(() => {
      if (resultsStore.recommendedTemplates[props.selected.smiles]) {
        return Object.values(resultsStore.recommendedTemplates[props.selected.smiles]);
      } else {
        return [];
      }
    });

    const openRecTemplatesModal = () => {
      if (!props.selected) {
        return;
      }
      predict(props.selected.smiles, props.selectedTemplate);
    }

    const predict = (smiles, selectedTemplate) => {
      loading.value = true;
      resultsStore.templateRelevance(smiles, selectedTemplate)
        .finally(() => {
          loading.value = false;
        });
    };

    const apply = (smiles, template) => {
      applyingTemplate.value = template._id;
      try {
        resultsStore.applyTemplate({ smiles: smiles, template: template }).finally(() => {
          if (rtmTable.value) {
            rtmTable.value.refresh();
          }
          applyingTemplate.value = null;
        });
      } catch (err) {
        console.log(err)
      }
    };


    const propShow = computed({
      get() {
        return props.visible
      },
      set(newVal) {
        context.emit("close-dialog", newVal)
      }
    })

    watch(propShow, (newVal) => {
      if (newVal) {
        openRecTemplatesModal();
      }
    });

    const close = () => {
      context.emit("close-dialog", false)
    }

    return {
      rtmFields,
      rtmItemsPerPage,
      rtmCurrentPage,
      rtmItems,
      loading,
      openRecTemplatesModal,
      predict,
      close,
      apply,
      applyingTemplate,
      propShow,
      templateSetsList
    };
  },
  mounted() {
    // The mounted lifecycle hook will signal the "ready" event when this component is rendered, allowing the parent to know that this component has finished rendering.
    this.$emit("ready");
    API.get("/api/template/sets", null, false).then((json) => {
      this.templateSetsList = json["template_sets"];
    });
  },
};
</script>
