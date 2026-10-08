<template>
  <form class="opt-rail" :aria-busy="disabled" @submit.prevent="$emit('recommend')">
    <fieldset class="opt-parameter-fields" :disabled="disabled">
    <section class="opt-rail-section">
      <h2>实测响应</h2>
      <label class="opt-field"
        >响应列<select
          :value="target.name"
          aria-label="实测响应列"
          @change="$emit('update-target', { name: $event.target.value })"
        >
          <option value="" disabled>未选择</option>
          <option
            v-for="column in responseColumns"
            :key="column.name"
            :value="column.name"
          >
            {{ column.name }}
          </option>
        </select></label
      >
      <label class="opt-field"
        >目标<select
          :value="target.kind"
          aria-label="响应目标类型"
          @change="$emit('update-target', { kind: $event.target.value })"
        >
          <option value="yield_percent">收率 (%)</option>
          <option value="response">其他数值响应</option>
        </select></label
      >
      <div v-if="target.kind === 'response'" class="opt-field-pair">
        <label class="opt-field"
          >方向<select
            :value="target.direction"
            aria-label="优化方向"
            @change="$emit('update-target', { direction: $event.target.value })"
          >
            <option value="maximize">最大化</option>
            <option value="minimize">最小化</option>
          </select></label
        >
        <label class="opt-field"
          >单位<input
            :value="target.unit"
            aria-label="响应单位"
            maxlength="32"
            @input="$emit('update-target', { unit: $event.target.value })"
        /></label>
      </div>
      <label v-else class="opt-fixed-target">最大化收率 · 实测单位 %</label>
    </section>
    <section class="opt-rail-section">
      <h2>
        实验因子 <span>{{ factors.length }} / 8</span>
      </h2>
      <div
        v-for="column in factorColumns"
        :key="column.name"
        class="opt-factor"
      >
        <label class="opt-factor-label"
          ><input
            type="checkbox"
            :aria-label="`因子 ${column.name}`"
            :checked="!!factorFor(column.name)"
            :disabled="!factorFor(column.name) && factors.length >= 8"
            @change="$emit('toggle-factor', column)"
          /><span>{{ column.name }}</span
          ><small>{{ column.unique_count }} 水平</small></label
        >
        <template v-if="factorFor(column.name)">
          <label class="opt-field"
            >类型<select
              :value="factorFor(column.name).kind"
              :aria-label="`${column.name} 因子类型`"
              @change="
                $emit('update-factor', column.name, {
                  kind: $event.target.value,
                })
              "
            >
              <option value="numerical">数值 · 离散</option>
              <option value="categorical">分类 · 独热编码</option>
            </select></label
          >
          <label class="opt-field"
            >候选水平<textarea
              :value="factorFor(column.name).levels"
              :aria-label="`${column.name} 候选水平`"
              :aria-invalid="!!levelError(column.name)"
              rows="3"
              @input="
                $emit('update-factor', column.name, {
                  levels: $event.target.value,
                })
              "
            />
          </label>
          <p
            v-if="levelError(column.name)"
            class="opt-level-error"
            role="status"
          >
            {{ levelError(column.name) }}
          </p>
        </template>
      </div>
    </section>
    <section class="opt-rail-section">
      <h2>下一批实验</h2>
      <label class="opt-field"
        >实验数<input
          type="number"
          :value="batchSize"
          min="1"
          max="8"
          step="1"
          aria-label="下一批实验数"
          @input="$emit('update:batchSize', $event.target.value)"
      /></label>
      <dl class="opt-counts">
        <dt>候选组合</dt>
        <dd :class="{ 'opt-error-text': count > 4096 }">
          {{ count.toLocaleString() }} / 4096
        </dd>
        <dt>实测记录</dt>
        <dd>{{ selectedCount }} / 256</dd>
      </dl>
      <details class="opt-seed-setting"><summary>高级设置</summary>
        <label class="opt-field">随机种子<input :value="seed" type="number" min="0" max="4294967295" step="1"
          aria-label="随机种子" @input="$emit('update:seed', $event.target.value)" /></label>
      </details>
      <label class="opt-confirmation"
        ><input
          type="checkbox"
          :checked="confirmedMeasurements"
          :disabled="selectedCount < 3"
          @change="$emit('update:confirmedMeasurements', $event.target.checked)"
        /><span>确认已选记录来自真实实验，且响应列与单位正确</span></label
      >
      <label class="opt-confirmation"
        ><input
          type="checkbox"
          :checked="confirmedCandidates"
          :disabled="!count || count > 4096"
          @change="$emit('update:confirmedCandidates', $event.target.checked)"
        /><span>确认离散水平的全部组合可作为候选实验条件</span></label
      >
      <v-btn
        type="submit"
        color="primary"
        variant="flat"
        prepend-icon="mdi-flask-outline"
        :disabled="!canRecommend"
        :loading="running"
        >推荐下一批</v-btn
      >
    </section>
    </fieldset>
  </form>
</template>
<script setup>
import { computed } from "vue";
import { factorValues } from "./model";
const props = defineProps({
  columns: { type: Array, required: true },
  factors: { type: Array, required: true },
  target: { type: Object, required: true },
  batchSize: [Number, String],
  selectedCount: Number,
  count: Number,
  confirmedMeasurements: Boolean,
  confirmedCandidates: Boolean,
  canRecommend: Boolean,
  running: Boolean,
  disabled: Boolean,
  seed: { type: [Number, String], default: 42 },
});
defineEmits([
  "toggle-factor",
  "update-target",
  "update-factor",
  "update:batchSize",
  "update:seed",
  "update:confirmedMeasurements",
  "update:confirmedCandidates",
  "recommend",
]);
const responseColumns = computed(() =>
  props.columns.filter(
    (column) => column.selectable !== false,
  ),
);
const factorColumns = computed(() =>
  props.columns.filter(
    (column) =>
      column.name !== props.target.name &&
      column.unique_count >= 2 &&
      column.selectable !== false,
  ),
);
const factorFor = (name) =>
  props.factors.find((factor) => factor.name === name);
const levelError = (name) => {
  try {
    factorValues(factorFor(name));
    return "";
  } catch (error) {
    return error.message;
  }
};
</script>
