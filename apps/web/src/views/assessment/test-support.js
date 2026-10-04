// Component state fixtures come from actual new RDKit calculators, not experiment data.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { defineComponent, ref } from "vue";

export function realCalculation(endpoint, body) {
  const code = [
    "import json,sys",
    "from packages.chemistry.assessment import assess_molecule",
    "from packages.chemistry.process_metrics import ProcessInput,calculate_process",
    "body=json.loads(sys.argv[2])",
    "value=assess_molecule(body['smiles']) if sys.argv[1]=='assessment' else calculate_process(ProcessInput.model_validate(body))",
    "print(value.model_dump_json())",
  ].join("\n");
  return JSON.parse(execFileSync(process.env.X_SYNTH_TEST_PYTHON || "python3", ["-c", code, endpoint, JSON.stringify(body)], {
    cwd: resolve(process.cwd(), "../.."), encoding: "utf8", timeout: 15000,
  }));
}

export const structureStub = defineComponent({
  name: "StructureInput", props: ["modelValue", "label", "disabled"], emits: ["update:modelValue"],
  setup(_, { expose }) { const pending = ref(false); expose({ pending }); return { pending }; },
  template: `<textarea :value="modelValue" :disabled="disabled" :aria-label="label" @input="$emit('update:modelValue', $event.target.value)" />`,
});
export const calculationStubs = {
  ModuleWorkbench: { template: "<section><slot /></section>" }, StructureInput: structureStub,
  SmilesImage: { props: ["smiles"], template: '<span class="structure-identity">{{ smiles }}</span>' },
  VBtn: { props: ["disabled"], template: '<button :disabled="disabled"><slot /></button>' },
  VTooltip: { template: '<span><slot name="activator" :props="{}" /></span>' },
  VIcon: true, VProgressCircular: true,
  RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
};

export function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
