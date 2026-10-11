import { defineComponent, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { useEditorInspectorFocus } from "./useEditorInspectorFocus";

const wrappers = [];
const initialWidth = window.innerWidth;
beforeEach(() => { window.innerWidth = 1440; });
function setup() {
  const wrapper = mount(defineComponent({
    setup() {
      const selected = ref(null), context = ref("document-a"), locked = ref(false), canvas = ref(null), inspector = ref(null);
      const focus = useEditorInspectorFocus({ selected, context, locked, canvas, inspector });
      return { selected, context, locked, canvas, inspector, ...focus };
    },
    template: `<section><div ref="canvas"><button class="origin" @click="select('m', $event)">Molecule</button></div>
      <aside v-if="selected" ref="inspector" tabindex="-1"><button class="close" @click="close">Close</button></aside>
      <button class="outside">Other action</button></section>`,
  }), { attachTo: document.body });
  wrappers.push(wrapper);
  wrapper.get('.origin').element.getClientRects = () => [{ width: 40, height: 30 }];
  return wrapper;
}
async function enter(wrapper, detail = 0) {
  const origin = wrapper.get('.origin').element;
  origin.focus(); origin.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
  await flushPromises(); return origin;
}
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); window.innerWidth = initialWidth; });

test("keyboard detail entry and close retain the exact graph origin without moving the camera", async () => {
  const wrapper = setup(), origin = await enter(wrapper);
  expect(document.activeElement).toBe(wrapper.get('aside').element);
  wrapper.get('.close').element.focus(); await wrapper.get('.close').trigger('click');
  await flushPromises(); expect(document.activeElement).toBe(origin);
});

test("desktop pointer entry does not move focus to details", async () => {
  const wrapper = setup(), origin = await enter(wrapper, 1);
  expect(document.activeElement).toBe(origin);
});

test("narrow-screen pointer entry reveals its detail panel", async () => {
  window.innerWidth = 390;
  const wrapper = setup(); await enter(wrapper, 1);
  expect(document.activeElement).toBe(wrapper.get('aside').element);
});

test("document replacement retires both pending entry and return", async () => {
  const wrapper = setup();
  const origin = wrapper.get('.origin').element;
  const pending = wrapper.vm.select('m', { detail: 0, target: origin });
  wrapper.vm.context = "document-b"; await pending;
  expect(document.activeElement).not.toBe(wrapper.get('aside').element);
  await enter(wrapper);
  wrapper.get('.close').element.focus();
  const leaving = wrapper.vm.close(); wrapper.vm.context = "document-c";
  await leaving; expect(document.activeElement).not.toBe(origin);
});

test("new focus, hidden origins and edit locks prevent stale handoffs", async () => {
  const wrapper = setup(), origin = await enter(wrapper);
  wrapper.get('.close').element.focus();
  const leaving = wrapper.vm.close(); wrapper.get('.outside').element.focus();
  await leaving; expect(document.activeElement).toBe(wrapper.get('.outside').element);
  await enter(wrapper); origin.hidden = true;
  await wrapper.vm.close(); expect(document.activeElement).not.toBe(origin);
  origin.hidden = false;
  wrapper.vm.locked = true; await wrapper.vm.select('m', { detail: 0, target: origin });
  expect(wrapper.vm.selected).toBeNull();
});
