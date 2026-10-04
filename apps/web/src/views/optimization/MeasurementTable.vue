<template>
  <section class="opt-measurements" aria-label="实测记录">
    <div class="opt-table-bar">
      <span
        >{{ table.row_count }} 条记录 · 已选择 {{ selectedRows.length }}</span
      >
      <div class="opt-pagination">
        <v-btn
          icon="mdi-chevron-left"
          variant="text"
          size="small"
          title="上一页"
          aria-label="上一页"
          :disabled="page === 1"
          @click="page--"
        />
        <span>{{ page }} / {{ pages }}</span>
        <v-btn
          icon="mdi-chevron-right"
          variant="text"
          size="small"
          title="下一页"
          aria-label="下一页"
          :disabled="page === pages"
          @click="page++"
        />
      </div>
    </div>
    <div class="opt-table-scroll">
      <table>
        <thead>
          <tr>
            <th class="opt-select-column">
              <input
                type="checkbox"
                aria-label="选择本页实测记录"
                :checked="allPageSelected"
                :indeterminate="somePageSelected && !allPageSelected"
                @change="
                  $emit(
                    'select-page',
                    visibleRows.map((row) => row.index),
                    $event.target.checked,
                  )
                "
              />
            </th>
            <th>记录</th>
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
                :aria-label="`选择实测记录 ${row.index}`"
                :checked="selectedRows.includes(row.index)"
                :disabled="
                  !selectedRows.includes(row.index) &&
                  selectedRows.length >= 256
                "
                @change="$emit('toggle-row', row.index)"
              />
            </td>
            <td class="opt-row-number">{{ row.index }}</td>
            <td v-for="column in table.columns" :key="column.name">
              {{ row.values[column.name] || "缺失" }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
<script setup>
import { computed, ref, watch } from "vue";
const props = defineProps({
  table: { type: Object, required: true },
  selectedRows: { type: Array, required: true },
});
defineEmits(["toggle-row", "select-page"]);
const page = ref(1),
  pageSize = 50;
const pages = computed(() =>
  Math.max(1, Math.ceil(props.table.row_count / pageSize)),
);
const visibleRows = computed(() =>
  props.table.rows.slice((page.value - 1) * pageSize, page.value * pageSize),
);
const allPageSelected = computed(() =>
  visibleRows.value.every((row) => props.selectedRows.includes(row.index)),
);
const somePageSelected = computed(() =>
  visibleRows.value.some((row) => props.selectedRows.includes(row.index)),
);
watch(
  () => props.table.table_sha256,
  () => {
    page.value = 1;
  },
);
</script>
