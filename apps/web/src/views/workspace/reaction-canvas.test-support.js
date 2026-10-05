import { defineComponent, nextTick, ref, watch } from "vue";

// This boundary fixture supplies explicit identities; it does not parse chemistry.
export const reactionInput = defineComponent({
  name: "ReactionInput",
  props: ["modelValue", "label", "disabled", "requireReactants"],
  emits: ["update:modelValue"],
  setup(props, { emit, expose }) {
    const pending = ref(false), product = ref(""), reactants = ref([]), agents = ref([]);
    watch(() => props.modelValue, (value) => { pending.value = !!value; }, { flush: "sync" });
    function clear() {
      pending.value = false;
      product.value = "";
      reactants.value = [];
      agents.value = [];
      emit("update:modelValue", "");
    }
    const importRevision = ref(0);
    function cancelImport() { importRevision.value++; }
    expose({ pending, product, reactants, agents, clear, cancelImport, importRevision });
    return { pending, agents };
  },
  template: `<div class="reaction-boundary"><textarea class="reaction-text"
    :aria-label="label" :value="modelValue" :disabled="disabled"
    @input="$emit('update:modelValue', $event.target.value)" />
    <button type="button" class="draft" @click="pending = !pending">Draft</button>
    <span v-for="(agent, index) in agents" :key="index" class="input-agent">{{ agent.smiles }}</span></div>`,
});

export function reactionDraft(wrapper) {
  return wrapper.getComponent(reactionInput).vm.$.exposed;
}

export async function setReactionDraft(wrapper, values) {
  const state = reactionDraft(wrapper);
  for (const [role, value] of Object.entries(values)) state[role].value = value;
  if (!Object.hasOwn(values, "pending") && (Object.hasOwn(values, "product") || Object.hasOwn(values, "reactants")))
    state.pending.value = false;
  await nextTick();
}

export const structureInput = defineComponent({
  name: "StructureInput",
  props: ["modelValue", "label", "disabled"],
  emits: ["update:modelValue"],
  setup(_, { expose }) {
    const pending = ref(false);
    expose({ pending });
    return { pending };
  },
  template: `<div><textarea class="molecule-text" :aria-label="label"
    :value="modelValue" :disabled="disabled" @input="$emit('update:modelValue', $event.target.value)" />
    <button type="button" class="draft" @click="pending = !pending">Draft</button></div>`,
});

export const uiStubs = {
  ReactionInput: reactionInput,
  StructureInput: structureInput,
  VBtn: {
    props: ["disabled", "loading", "type"],
    template: '<button :type="type || \'button\'" :disabled="disabled || loading"><slot /></button>',
  },
  VTextField: {
    props: ["modelValue", "label", "disabled", "errorMessages"],
    emits: ["update:modelValue"],
    template: `<label>{{ label }}<input :value="modelValue" :aria-label="label" :disabled="disabled"
      @input="$emit('update:modelValue', $event.target.value)" /><span>{{ errorMessages }}</span></label>`,
  },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VIcon: true,
};

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
