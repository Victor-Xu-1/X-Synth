<template>
  <form v-show="section !== 'measurements'" class="opt-rail" :hidden="section === 'measurements'"
    :inert="section === 'measurements' || undefined" :aria-busy="disabled" @submit.prevent="submit">
    <fieldset class="opt-parameter-fields" :disabled="disabled">
    <section v-show="section === 'factors'" :id="configurationPanel" data-section="factors" class="opt-configuration-grid"
      role="tabpanel" tabindex="-1" :aria-labelledby="configurationTab" :hidden="section !== 'factors'" :inert="section !== 'factors' || undefined">
    <section class="opt-rail-section opt-response-fields">
      <h2>{{ $tr('实测响应') }}</h2>
      <label class="opt-field"
        >{{ $tr('响应列') }}<select
          :value="target.name"
          :aria-label="$tr('实测响应列')"
          @change="$emit('update-target', { name: $event.target.value })"
        >
          <option value="" disabled>{{ $tr('未选择') }}</option>
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
        >{{ $tr('目标') }}<select
          :value="target.kind"
          :aria-label="$tr('响应目标类型')"
          @change="$emit('update-target', { kind: $event.target.value })"
        >
          <option value="yield_percent">{{ $tr('收率 (%)') }}</option>
          <option value="response">{{ $tr('其他数值响应') }}</option>
        </select></label
      >
      <div v-if="target.kind === 'response'" class="opt-field-pair">
        <label class="opt-field"
          >{{ $tr('方向') }}<select
            :value="target.direction"
            :aria-label="$tr('优化方向')"
            @change="$emit('update-target', { direction: $event.target.value })"
          >
            <option value="maximize">{{ $tr('最大化') }}</option>
            <option value="minimize">{{ $tr('最小化') }}</option>
          </select></label
        >
        <label class="opt-field"
          >{{ $tr('单位') }}<input
            :value="target.unit"
            :aria-label="$tr('响应单位')"
            maxlength="32"
            @input="$emit('update-target', { unit: $event.target.value })"
        /></label>
      </div>
      <label v-else class="opt-fixed-target">{{ $tr('最大化收率 · 实测单位 %') }}</label>
    </section>
    <section class="opt-rail-section opt-factor-fields">
      <h2> {{ $tr('实验因子') }} <span>{{ factors.length }} / {{ LIMITS.factors }}</span>
      </h2>
      <div
        v-for="column in factorColumns"
        :key="column.name"
        class="opt-factor"
      >
        <label class="opt-factor-label"
          ><input
            type="checkbox"
            :aria-label="$tr('因子 {name}', { name: column.name })"
            :checked="!!factorFor(column.name)"
            :disabled="!factorFor(column.name) && factors.length >= LIMITS.factors"
            @change="$emit('toggle-factor', column)"
          /><span>{{ column.name }}</span
          ><small>{{ $tr('{count} 水平', { count: factorFor(column.name) ? levelCount(column.name) : column.unique_count }) }}</small></label
        >
        <details v-if="factorFor(column.name)" class="opt-factor-settings">
          <summary><span>{{ $tr('候选水平') }}</span><small>{{ $tr(factorFor(column.name).kind === 'numerical' ? '数值 · 离散' : '分类 · 独热编码') }}</small></summary>
          <div class="opt-factor-editor">
          <label class="opt-field"
            >{{ $tr('类型') }}<select
              :value="factorFor(column.name).kind"
              :aria-label="$tr('{name} 因子类型', { name: column.name })"
              @change="
                $emit('update-factor', column.name, {
                  kind: $event.target.value,
                })
              "
            >
              <option value="numerical">{{ $tr('数值 · 离散') }}</option>
              <option value="categorical">{{ $tr('分类 · 独热编码') }}</option>
            </select></label
          >
          <label class="opt-field"
            >{{ $tr('候选水平') }}<textarea
              :value="factorFor(column.name).levels"
              :aria-label="$tr('{name} 候选水平', { name: column.name })"
              :aria-invalid="!!levelError(column.name)"
              :aria-describedby="levelError(column.name) ? errorId(column.name) : undefined"
              rows="3"
              @input="
                $emit('update-factor', column.name, {
                  levels: $event.target.value,
                })
              "
            />
          </label>
          </div>
        </details>
        <p v-if="factorFor(column.name) && levelError(column.name)" :id="errorId(column.name)" class="opt-level-error" role="status">
          {{ optimizationMessage(levelError(column.name)) }}
        </p>
      </div>
    </section>
    </section>
    <section v-show="section === 'batch'" :id="batchPanel" data-section="batch" class="opt-batch-panel opt-rail-section"
      role="tabpanel" tabindex="-1" :aria-labelledby="batchTab" :hidden="section !== 'batch'" :inert="section !== 'batch' || undefined">
      <h2>{{ $tr('下一批实验') }}</h2>
      <div class="opt-batch-grid"><div class="opt-batch-settings">
      <label class="opt-field"
        >{{ $tr('实验数') }}<input
          type="number"
          :value="batchSize"
          min="1"
          :max="LIMITS.batch"
          step="1"
          :aria-label="$tr('下一批实验数')"
          @input="$emit('update:batchSize', $event.target.value)"
      /></label>
      <dl class="opt-counts">
        <dt>{{ $tr('候选组合') }}</dt>
        <dd :class="{ 'opt-error-text': count > LIMITS.candidates }">
          {{ (count || 0).toLocaleString() }} / {{ LIMITS.candidates }}
        </dd>
        <dt>{{ $tr('实测记录') }}</dt>
        <dd>{{ selectedCount }} / {{ LIMITS.measurements }}</dd>
      </dl>
      <details class="opt-seed-setting"><summary>{{ $tr('高级设置') }}</summary>
        <label class="opt-field">{{ $tr('随机种子') }}<input :value="seed" type="number" min="0" max="4294967295" step="1"
          :aria-label="$tr('随机种子')" @input="$emit('update:seed', $event.target.value)" /></label>
      </details>
      </div><div class="opt-batch-confirmations">
      <label class="opt-confirmation"
        ><input
          type="checkbox"
          :checked="confirmedMeasurements"
          :disabled="selectedCount < 3"
          @change="$emit('update:confirmedMeasurements', $event.target.checked)"
        /><span>{{ $tr('确认已选记录来自真实实验，且响应列与单位正确') }}</span></label
      >
      <label class="opt-confirmation"
        ><input
          type="checkbox"
          :checked="confirmedCandidates"
          :disabled="!count || count > LIMITS.candidates"
          @change="$emit('update:confirmedCandidates', $event.target.checked)"
        /><span>{{ $tr('确认离散水平的全部组合可作为候选实验条件') }}</span></label
      >
      <v-btn
        type="submit"
        color="primary"
        variant="flat"
        prepend-icon="mdi-flask-outline"
        :disabled="disabled || !canRecommend"
        :loading="running"
        >{{ $tr('推荐下一批') }}</v-btn
      >
      </div></div>
    </section>
    </fieldset>
  </form>
</template>
<script setup>
import { computed, useId } from "vue";
import { factorValues, LIMITS } from "./model";
import { optimizationMessage } from "./ui-copy";
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
  section: { type: String, default: "factors" },
  configurationPanel: String,
  configurationTab: String,
  batchPanel: String,
  batchTab: String,
});
const emit = defineEmits([
  "toggle-factor",
  "update-target",
  "update-factor",
  "update:batchSize",
  "update:seed",
  "update:confirmedMeasurements",
  "update:confirmedCandidates",
  "recommend",
]);
function submit() {
  if (props.section === "batch" && !props.disabled && !props.running && props.canRecommend) emit("recommend");
}
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
const instanceId = useId(), errorId = name => `opt-factor-${instanceId}-${encodeURIComponent(name)}-error`;
const levelError = (name) => {
  try {
    factorValues(factorFor(name));
    return "";
  } catch (error) {
    return error.message;
  }
};
const levelCount = (name) => {
  try { return factorValues(factorFor(name)).length; }
  catch { return 0; }
};
</script>
