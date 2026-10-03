<template>
    <v-dialog v-model="propsShow" scrollable width="800px">
        <v-card>
            <v-card-title>
                结果信息
            </v-card-title>
            <v-card-text>
                <v-expansion-panels multiple>
                    <v-expansion-panel title="保存结果详情" data-cy="tree-builder-result-details">
                        <template v-slot:text>
                            <v-table class="mb-0">
                                <tr>
                                    <th>描述：</th>
                                    <td>{{ savedResultInfo.description }}</td>
                                </tr>
                                <tr>
                                    <th>修改时间：</th>
                                    <td>{{ savedResultInfo.modifiedDisp }}</td>
                                </tr>
                                <tr>
                                    <th>结果类型：</th>
                                    <td>{{ savedResultInfo.type }}</td>
                                </tr>
                                <tr>
                                    <th>标签</th>
                                    <td>
                                        <v-chip v-for="tag in savedResultInfo.tags" :key="tag" class="mr-1">{{ tag
                                            }}</v-chip>
                                    </td>
                                </tr>
                            </v-table>
                        </template>
                    </v-expansion-panel>
                    <v-expansion-panel v-if="savedResultInfo.type === 'tree_builder'" title="路线树任务设置"
                        data-cy="tree-builder-job-settings">
                        <template v-slot:text>
                            <tb-settings-table v-if="savedResultInfo.tbSettings" :settings="savedResultInfo.tbSettings"
                                :targetSmiles="savedResultInfo.target"
                                :tbVersion="savedResultInfo.tbVersion"></tb-settings-table>
                        </template>
                    </v-expansion-panel>
                    <v-expansion-panel title="路线树任务统计" data-cy="tree-builder-job-statistics">
                        <template v-slot:text>
                            <v-table class="mb-0">
                                <tr v-for="(value, key) in savedResultInfo.tbStats" :key="key">
                                    <th>{{ key[0].toUpperCase() + key.slice(1).replaceAll("_", " ") + ":" }}</th>
                                    <td>{{ Number.isInteger(value) ? value : value.toFixed(2) }}</td>
                                </tr>
                            </v-table>
                        </template>
                    </v-expansion-panel>
                </v-expansion-panels>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn @click="() => { propsShow = false }">确定</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script>
import { defineComponent, computed } from "vue";
import TbSettingsTable from "@/components/TbSettingsTable";
import { useResultsStore } from "@/store/results";

export default defineComponent({
    name: "ResultInfoModal",
    props: {
        visible: {
            type: Boolean,
            default: false,
        }
    },
    components: {
        TbSettingsTable,
    },
    setup(props, context) {
        const propsShow = computed({
            get() {
                return props.visible;
            },
            set(newValue) {
                context.emit('close', newValue)
            }
        })
        const resultsStore = useResultsStore();

        const savedResultInfo = computed(() => resultsStore.savedResultInfo);

        return {
            savedResultInfo,
            propsShow
        };
    },
});
</script>
