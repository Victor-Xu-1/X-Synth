<template>
  <div v-if="visible" ref="defaultRef">
    <slot name="default" />
  </div>
</template>

<script>
import { jsPanel } from "jspanel4";
import "jspanel4/dist/jspanel.min.css";
import { ref, onMounted, watchEffect, toRefs, nextTick } from 'vue'

export default {
  name: "JsPanel",
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
    options: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props, { emit }) {
    const { visible, options } = toRefs(props);
    const panel = ref(null);
    const defaultRef = ref(null);

    const close = () => {
      panel.value = null;
      emit("close");
    };

    const panelOptions = ref({ ...options.value, onclosed: close });

    const createPanel = async () => {
      await nextTick();
      let panelOpts = {
        content: defaultRef.value,
        ...panelOptions.value
      };
      jsPanel.ziBase = 1000;
      panel.value = jsPanel.create(panelOpts);
    };

    const closePanel = () => {
      if (panel.value) {
        panel.value.close();
      }
    };

    onMounted(() => {
      if (visible.value) {
        createPanel();
      }
    });

    watchEffect(() => {
      if (visible.value) {
        createPanel();
      } else if (panel.value) {
        closePanel();
      }
    });

    return {
      defaultRef,
      createPanel,
      closePanel,
      close,
    };
  }
};
</script>
