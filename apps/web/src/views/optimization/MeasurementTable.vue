<template>
  <section class="opt-measurements" :aria-label="$tr('实测记录')">
    <div class="opt-table-bar">
      <fieldset class="opt-table-filter" :disabled="disabled">
        <legend class="opt-visually-hidden">{{ $tr('实测记录选择') }}</legend>
        <label :class="{ active: view === 'all' }"><input v-model="view" type="radio" :name="filterId" value="all" />{{ $tr('全部记录') }}</label>
        <label :class="{ active: view === 'selected' }"><input v-model="view" type="radio" :name="filterId" value="selected" />{{ $tr('已选实测记录') }}</label>
      </fieldset>
      <div class="opt-pagination">
        <v-btn
          icon="mdi-chevron-left"
          variant="text"
          size="small"
          :title="$tr('上一页')"
          :aria-label="$tr('上一页')"
          :disabled="disabled || page === 1"
          @click="page--"
        />
        <span aria-live="polite">{{ page }} / {{ pages }}</span>
        <v-btn
          icon="mdi-chevron-right"
          variant="text"
          size="small"
          :title="$tr('下一页')"
          :aria-label="$tr('下一页')"
          :disabled="disabled || page === pages"
          @click="page++"
        />
      </div>
    </div>
    <div class="opt-selection-count" role="status">{{ $tr('{total} 条记录 · 已选择 {selected}', { total: table.row_count, selected: selectedRows.length }) }}</div>
    <div v-if="!filteredRows.length" class="opt-selection-empty" role="status">{{ $tr('尚无已选实验数据') }}</div>
    <div v-show="filteredRows.length" ref="scroll" class="opt-table-scroll" role="region" :aria-label="$tr('实测记录表')" tabindex="0">
      <table class="opt-data-table">
        <thead>
          <tr>
            <th scope="col" class="opt-select-column">
              <input
                type="checkbox"
                :aria-label="$tr('选择本页实测记录')"
                :checked="allPageSelected"
                :indeterminate="somePageSelected && !allPageSelected"
                :disabled="disabled || !visibleRows.length"
                @change="selectVisibleRows"
              />
            </th>
            <th scope="col" class="opt-record-column">{{ $tr('记录') }}</th>
            <th v-for="column in table.columns" :key="column.name" scope="col" :class="{ 'opt-target-column': column.name === targetName }">
              <span class="opt-column-name">{{ column.name }}</span>
              <small v-if="column.name === targetName" class="opt-column-role">{{ $tr('实测响应') }}</small>
              <small v-else-if="factorNames.includes(column.name)" class="opt-column-role">{{ $tr('实验因子') }}</small>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in visibleRows"
            :key="row.index"
            :class="{ selected: selection.has(row.index) }"
          >
            <td class="opt-select-column">
              <input
                type="checkbox"
                :aria-label="$tr('选择实测记录 {index}', { index: row.index })"
                :checked="selection.has(row.index)"
                :disabled="
                  disabled || !selection.has(row.index) && selectedRows.length >= LIMITS.measurements
                "
                @change="$emit('toggle-row', row.index)"
              />
            </td>
            <th scope="row" class="opt-row-number opt-record-column">{{ row.index }}</th>
            <td v-for="column in table.columns" :key="column.name" :class="{ 'opt-target-column': column.name === targetName, 'opt-numeric-cell': column.numeric }">
              {{ row.values[column.name] === '' || row.values[column.name] == null ? $tr('缺失') : row.values[column.name] }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<script setup>
import { computed, nextTick, reactive, ref, useId, watch } from "vue";
import { LIMITS } from "./model";
const props = defineProps({
  table: { type: Object, required: true },
  selectedRows: { type: Array, required: true },
  targetName: { type: String, default: "" },
  factorNames: { type: Array, default: () => [] },
  disabled: Boolean,
});
const emit = defineEmits(["toggle-row", "select-page"]);
const view = ref("all"), positions = reactive({ all: 1, selected: 1 }), scroll = ref(null);
const filterId = `opt-record-filter-${useId()}`, pageSize = 50;
const selection = computed(() => new Set(props.selectedRows));
const filteredRows = computed(() => view.value === "selected"
  ? props.table.rows.filter(row => selection.value.has(row.index)) : props.table.rows);
const pages = computed(() =>
  Math.max(1, Math.ceil(filteredRows.value.length / pageSize)),
);
const page = computed({ get: () => Math.min(positions[view.value], pages.value),
  set: value => { positions[view.value] = Math.max(1, Math.min(value, pages.value)); } });
const visibleRows = computed(() =>
  filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const allPageSelected = computed(() =>
  visibleRows.value.length > 0 && visibleRows.value.every((row) => selection.value.has(row.index)),
);
const somePageSelected = computed(() =>
  visibleRows.value.some((row) => selection.value.has(row.index)),
);
async function selectVisibleRows(event) {
  const input = event.target;
  if (!props.disabled) emit("select-page", visibleRows.value.map((row) => row.index), input.checked);
  await nextTick();
  // A rejected command leaves props unchanged, but the native checkbox already toggled.
  input.checked = allPageSelected.value;
  input.indeterminate = somePageSelected.value && !allPageSelected.value;
}
watch(
  () => props.table.table_sha256,
  () => {
    view.value = "all";
    positions.all = positions.selected = 1;
    if (scroll.value) scroll.value.scrollLeft = 0;
  },
);
watch([view, page], () => { if (scroll.value) scroll.value.scrollTop = 0; });
watch(pages, value => { positions[view.value] = Math.min(positions[view.value], value); });
</script>
