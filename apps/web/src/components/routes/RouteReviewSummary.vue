<template>
  <section
    class="route-review-summary"
    aria-label="软件自动核验与参考覆盖"
  >
    <div class="review-row">
      <span class="review-heading">
        <v-icon icon="mdi-shield-search" size="16" aria-hidden="true" />
        软件自动核验
      </span>
      <span class="review-item" data-review="forward">
        独立正向预测：
        <template v-if="summary.forward.status === 'ready'">
          <template v-if="summary.forward.total">
            <strong>{{ summary.forward.matched }}/{{ summary.forward.total }}</strong>
            步核验匹配
          </template>
          <template v-else>无反应步骤</template>
        </template>
        <template v-else>{{ stateLabels[summary.forward.status] }}</template>
      </span>
      <span class="review-item" data-review="references">
        <v-icon
          icon="mdi-book-open-page-variant-outline"
          size="16"
          aria-hidden="true"
        />
        参考覆盖：
        <template v-if="summary.references.status === 'ready'">
          <template v-if="summary.references.total">
            同反应 {{ summary.references.reaction }} 步 ·
            同产物资料 {{ summary.references.product }} 步 ·
            检索未匹配 {{ summary.references.unmatched }} 步
            <template v-if="summary.references.coverage?.unchecked">
              · 未检索 {{ summary.references.coverage.unchecked }} 步
            </template>
          </template>
          <template v-else>无反应步骤</template>
        </template>
        <template v-else>{{ stateLabels[summary.references.status] }}</template>
      </span>
    </div>
    <p v-if="summary.references.coverage && (summary.references.coverage.truncated || summary.references.coverage.unavailable || summary.references.coverage.unknown)" class="review-boundary" data-review="coverage">
      <span v-if="summary.references.coverage.truncated">
        {{ summary.references.coverage.truncated }} 步还有更多参考记录。
      </span>
      <span v-if="summary.references.coverage.unavailable">
        {{ summary.references.coverage.unavailable }} 步部分资料源不可用。
      </span>
      <span v-if="summary.references.coverage.unknown">
        {{ summary.references.coverage.unknown }} 步的检索范围未记录。
      </span>
    </p>
    <p class="review-boundary">
      模型预测不等于实测；同产物资料不证明同反应。结构匹配不验证条件与收率。
    </p>
  </section>
</template>
<script setup>
import { computed } from "vue";
import { readRouteReviewSummary } from "./route-review-summary";

const props = defineProps({ candidate: Object });
const summary = computed(() => readRouteReviewSummary(props.candidate));
const stateLabels = {
  missing: "未记录",
  invalid: "记录格式无效",
  unsupported: "记录版本不支持",
};
</script>
<style scoped>
.route-review-summary {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 0;
  border-top: 1px solid var(--ws-border);
  color: var(--ws-text);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.review-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 16px;
  min-width: 0;
}
.review-heading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 550;
}
.review-item {
  min-width: 0;
}
.review-item > .v-icon {
  margin-right: 4px;
}
.review-boundary {
  margin: 4px 0 0;
  color: var(--ws-muted);
  font-size: 11px;
}
</style>
