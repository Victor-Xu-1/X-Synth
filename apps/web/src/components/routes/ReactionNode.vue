<template>
  <div class="reaction-graph-node" :class="{ selected }">
    <Handle type="target" :position="Position.Left" />
    <v-tooltip v-if="!data.overview" :text="$tr('查看{name}详情', { name: label })">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          type="button"
          class="reaction-detail-action nodrag"
          :class="{ 'reaction-disc': data.reading }"
          icon
          variant="text"
          :aria-label="$tr('查看{name}详情', { name: label })"
          @keydown.enter.stop
          @keydown.space.stop
          @keyup.enter.stop
          @keyup.space.stop
        >
          <v-icon class="reaction-direction-icon" icon="mdi-arrow-right" :size="data.reading ? 22 : 18" />
        </v-btn>
      </template>
    </v-tooltip>
    <div v-else-if="data.reading" class="reaction-disc">
      <v-icon
        class="reaction-direction-icon"
        icon="mdi-arrow-right"
        size="22"
      />
    </div>
    <v-icon
      v-else
      class="reaction-direction-icon"
      icon="mdi-arrow-right"
      size="18"
    />
    <strong :title="label">{{ label }}</strong>
    <small v-if="typeof data.score === 'number' && Number.isFinite(data.score)"
      :title="$tr('步骤分数 {value}', { value: data.score.toFixed(2) })"
      >{{ $tr('步骤分数 {value}', { value: data.score.toFixed(2) }) }}</small
    >
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
<script setup>
import { Handle, Position } from "@vue-flow/core";
import { computed } from "vue";
import { uiText } from "@/i18n";
import { generatedReactionUiLabel } from "./route-ui-text";
const props = defineProps({ data: { type: Object, required: true }, selected: Boolean });
const label = computed(() => props.data.generatedStepLabels ? generatedReactionUiLabel(props.data.label) : props.data.label || uiText("反应"));
</script>
<style scoped>
.reaction-graph-node {
  line-height: 1.5;
  gap: 4px;
}
.reaction-disc {
  color: var(--ws-text);
}
.selected .reaction-disc {
  color: var(--ws-accent, #0b7163);
}
.reaction-detail-action {
  padding: 0;
  width: 18px;
  height: 18px;
  min-width: 18px;
  min-height: 18px;
  color: inherit;
}
.reaction-detail-action.reaction-disc {
  width: 38px;
  height: 38px;
  min-width: 38px;
  min-height: 38px;
}
.reaction-detail-action:focus-visible {
  outline: 2px solid var(--ws-accent, #0b7163);
  outline-offset: 2px;
}
.reaction-graph-node > strong {
  max-width: calc(var(--route-reaction-width) - 4px);
  font-size: 12px;
  font-weight: 600;
}
.reaction-graph-node > small {
  max-width: 100%;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reaction-direction-icon {
  /* html-to-image discovers fonts on elements, not on ::before. */
  font-family: "Material Design Icons";
}
</style>
