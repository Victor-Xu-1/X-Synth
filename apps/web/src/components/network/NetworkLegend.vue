<template>
  <div>
    <v-btn :class="expanded ? 'expand-toggle expand-parent-btn' : 'expand-toggle expand-parent'" size="small"
      variant="outlined" @click="expanded = !expanded">
      {{ expanded ? "收起" : "展开" }}图例
      <i v-if="expanded" class="fas fa-angle-down"></i>
      <i v-else class="fas fa-angle-up"></i>
    </v-btn>
    <div class="expand-parent">
      <div class="expand-content" :class="{ expanded: expanded }">
        <table>
          <thead>
            <tr>
              <th colspan="2">边框颜色</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="mdi mdi-square-outline mx-2 text-blue"></span></td>
              <td>目标分子</td>
            </tr>
            <tr>
              <td><span class="mdi mdi-square-outline mx-2 text-primary"></span></td>
              <td>可采购，且有反应历史</td>
            </tr>
            <tr>
              <td><span class="mdi mdi-square-outline mx-2 text-yellow"></span></td>
              <td>可采购，无反应历史</td>
            </tr>
            <tr>
              <td><span class="mdi mdi-square-outline mx-2 text-orange"></span></td>
              <td>不可采购，且有反应历史</td>
            </tr>
            <tr>
              <td><span class="mdi mdi-square-outline mx-2 text-red"></span></td>
              <td>不可采购，无反应历史</td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead>
            <tr>
              <th colspan="2">标注图标</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="mdi mdi-circle-outline mx-2 text-primary"></span></td>
              <td>具备该属性</td>
            </tr>
            <tr>
              <td><span class="mdi mdi-cancel mx-2 text-red"></span></td>
              <td>不具备该属性</td>
            </tr>
            <tr>
              <td class="text-center">$</td>
              <td>结构是否可采购</td>
            </tr>
            <tr>
              <td class="text-center">R</td>
              <td>是否有反应物历史</td>
            </tr>
            <tr>
              <td class="text-center">P</td>
              <td>是否有产物历史</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed } from "vue";
import { useTheme } from "@/composables/useTheme";

export default {
  name: "NetworkLegend",
  setup() {
    const expanded = ref(false);
    const { isDark } = useTheme();
    const backgroundColor = computed(() => {
      return isDark.value ? 'rgba(48, 48, 48, 0.8)' : 'rgba(255, 255, 255, 0.8)';
    });

    return {
      expanded,
      backgroundColor
    };
  },
};
</script>

<style scoped>
.expand-parent {
  position: absolute;
  bottom: 1px;
  left: 1px;
  overflow: hidden;
  transition: 0.5s ease;
}

.expand-parent-btn {
  position: absolute;
  bottom: 12rem;
  left: 1px;
  overflow: hidden;
  transition: 0.5s ease;
}

.expand-toggle {
  width: 10rem;
  margin: 0.5rem;
}

.expand-content {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  height: 12rem;
  padding: 0.5rem;
  background-color: v-bind(backgroundColor);
  margin-bottom: -12rem;
  transition: all 0.5s;
}

.expand-content.expanded {
  margin-bottom: 0;
}

.blue {
  color: #1965b0;
}

.yellow {
  color: #f6c141;
}

.orange {
  color: #e8601c;
}

.red {
  color: #dc050c;
}
</style>
