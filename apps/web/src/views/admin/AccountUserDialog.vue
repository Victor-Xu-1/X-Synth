<template>
  <v-dialog v-model="open" max-width="480" :persistent="loading">
    <v-card rounded="sm">
      <v-card-title class="account-dialog-heading">{{
        $tr(titles[mode])
      }}</v-card-title>
      <v-form ref="form" :disabled="loading || validating" @submit.prevent="submit">
        <v-card-text>
          <p v-if="mode !== 'new'" class="workspace-muted mb-4">
            {{ username }}
          </p>
          <v-text-field
            v-if="mode === 'new'"
            v-model="newUsername"
            :label="$tr('用户名')"
            variant="outlined"
            autocomplete="off"
            :rules="requiredRules"
            data-cy="admin-newUser-username"
          >
            <template #message="{ message }">{{ $tr(message) }}</template>
          </v-text-field>
          <v-text-field
            v-if="mode !== 'password'"
            v-model="email"
            :label="$tr('邮箱')"
            variant="outlined"
            type="email"
            autocomplete="off"
            :rules="emailRules"
            :data-cy="
              mode === 'new' ? 'admin-newUser-email' : 'admin-edit-user-value'
            "
          >
            <template #message="{ message }">{{ $tr(message) }}</template>
          </v-text-field>
          <v-text-field
            v-if="mode !== 'email'"
            v-model="password"
            :label="$tr('密码')"
            variant="outlined"
            type="password"
            autocomplete="new-password"
            :rules="requiredRules"
            :data-cy="
              mode === 'new'
                ? 'admin-newUser-password'
                : 'admin-edit-user-value'
            "
          >
            <template #message="{ message }">{{ $tr(message) }}</template>
          </v-text-field>
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            density="compact"
            role="alert"
            >{{ $tr(error) }}</v-alert
          >
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="loading"
            data-cy="openDialog-close"
            @click="open = false"
            >{{ $tr('取消') }}</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            :loading="loading || validating"
            :data-cy="
              mode === 'new' ? 'admin-newUser-submit' : 'openDialog-submit'
            "
            >{{ $tr('保存') }}</v-btn
          >
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from "vue";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  mode: { type: String, default: "new" },
  username: { type: String, default: "" },
  initialEmail: { type: String, default: "" },
  contextKey: { type: String, default: "" },
  loading: Boolean,
  error: { type: String, default: "" },
});
const emit = defineEmits(["save"]);
const titles = { new: "新建用户", email: "修改邮箱", password: "修改密码" };
const form = ref(null);
const newUsername = ref("");
const email = ref("");
const password = ref("");
const validating = ref(false);
let generation = 0;
const requiredRules = [(value) => Boolean(value?.trim()) || "此项为必填项"];
const emailRules = [
  (value) =>
    !value ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    "请输入有效的邮箱地址",
];

const editorContext = [open, () => props.mode, () => props.username, () => props.contextKey];
// Invalidate immediately; initialize after the parent has patched all editor props.
watch(editorContext, () => {
  generation++; validating.value = false;
  password.value = "";
  newUsername.value = "";
  email.value = "";
}, { flush: "sync" });
watch(editorContext, ([value]) => {
  email.value = value ? props.initialEmail : "";
}, { immediate: true });
const submit = async () => {
  if (!open.value || props.loading || validating.value) return;
  const ticket = generation, mode = props.mode, context = props.contextKey;
  const values = {
    username: mode === "new" ? newUsername.value.trim() : props.username,
  };
  if (mode !== "password") values.email = email.value.trim();
  if (mode !== "email") values.password = password.value;
  validating.value = true;
  try {
    const result = await form.value.validate();
    if (result.valid && ticket === generation && open.value && !props.loading)
      emit("save", values, context);
  } finally {
    if (ticket === generation) validating.value = false;
  }
};
onBeforeUnmount(() => { generation++; password.value = ""; email.value = ""; });
</script>

<style scoped>
.account-dialog-heading {
  font-size: 18px;
  padding: 20px 24px 0;
}
:deep(.v-btn),
:deep(.v-field) {
  border-radius: 7px;
}
</style>
