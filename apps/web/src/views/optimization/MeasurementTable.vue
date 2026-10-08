<template>
  <section class="opt-measurements" :aria-label="$tr('实测记录')">
    <div class="opt-table-bar">
      <span
        >{{ $tr('{total} 条记录 · 已选择 {selected}', { total: table.row_count, selected: selectedRows.length }) }}</span
      >
      <div class="opt-pagination">
        <v-btn
          icon="mdi-chevron-left"
          variant="text"
          size="small"
          :title="$tr('上一页')"
          :aria-label="$tr('上一页')"
          :disabled="page === 1"
          @click="page--"
        />
        <span>{{ page }} / {{ pages }}</span>
        <v-btn
          icon="mdi-chevron-right"
          variant="text"
          size="small"
          :title="$tr('下一页')"
          :aria-label="$tr('下一页')"
          :disabled="page === pages"
          @click="page++"
        />
      </div>
    </div>
    <div class="opt-table-scroll" role="region" :aria-label="$tr('实测记录表')" tabindex="0">
      <table class="opt-data-table">
        <thead>
          <tr>
            <th class="opt-select-column">
              <input
                type="checkbox"
                :aria-label="$tr('选择本页实测记录')"
                :checked="allPageSelected"
                :indeterminate="somePageSelected && !allPageSelected"
                @change="selectVisibleRows"
              />
            </th>
            <th>{{ $tr('记录') }}</th>
            <th v-for="column in table.columns" :key="column.name">
              {{ column.name }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visibleRows"
            :key="row.index"
            :class="{ selected: selectedRows.includes(row.index) }"
          >
            <td class="opt-select-column">
              <input
                type="checkbox"
                :aria-label="$tr('选择实测记录 {index}', { index: row.index })"
                :checked="selectedRows.includes(row.index)"
                :disabled="
                  !selectedRows.includes(row.index) &&
                  selectedRows.length >= LIMITS.measurements
                "
                @change="$emit('toggle-row', row.index)"
              />
            </td>
            <td class="opt-row-number">{{ row.index }}</td>
            <td v-for="column in table.columns" :key="column.name">
              {{ row.values[column.name] || $tr('缺失') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { LIMITS } from "./model";
const props = defineProps({
  table: { type: Object, required: true },
  selectedRows: { type: Array, required: true },
});
const emit = defineEmits(["toggle-row", "select-page"]);
const page = ref(1),
  pageSize = 50;
const pages = computed(() =>
  Math.max(1, Math.ceil(props.table.row_count / pageSize)),
);
const visibleRows = computed(() =>
  props.table.rows.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const allPageSelected = computed(() =>
  visibleRows.value.length > 0 && visibleRows.value.every((row) => props.selectedRows.includes(row.index)),
);
const somePageSelected = computed(() =>
  visibleRows.value.some((row) => props.selectedRows.includes(row.index)),
);
async function selectVisibleRows(event) {
  const input = event.target;
  emit("select-page", visibleRows.value.map((row) => row.index), input.checked);
  await nextTick();
  // A rejected command leaves props unchanged, but the native checkbox already toggled.
  input.checked = allPageSelected.value;
  input.indeterminate = somePageSelected.value && !allPageSelected.value;
}
watch(
  () => props.table.table_sha256,
  () => {
    page.value = 1;
  },
);
</script>
