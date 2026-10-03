<template>
  <v-dialog v-model="open" max-width="480" :persistent="loading">
    <v-card rounded="sm">
      <v-card-title class="account-dialog-heading">{{
        titles[mode]
      }}</v-card-title>
      <v-form ref="form" :disabled="loading" @submit.prevent="submit">
        <v-card-text>
          <p v-if="mode !== 'new'" class="workspace-muted mb-4">
            {{ username }}
          </p>
          <v-text-field
            v-if="mode === 'new'"
            v-model="newUsername"
            label="用户名"
            variant="outlined"
            autocomplete="off"
            :rules="requiredRules"
            data-cy="admin-newUser-username"
          />
          <v-text-field
            v-if="mode !== 'password'"
            v-model="email"
            label="邮箱"
            variant="outlined"
            type="email"
            autocomplete="off"
            :rules="emailRules"
            :data-cy="
              mode === 'new' ? 'admin-newUser-email' : 'admin-edit-user-value'
            "
          />
          <v-text-field
            v-if="mode !== 'email'"
            v-model="password"
            label="密码"
            variant="outlined"
            type="password"
            autocomplete="new-password"
            :rules="requiredRules"
            :data-cy="
              mode === 'new'
                ? 'admin-newUser-password'
                : 'admin-edit-user-value'
            "
          />
          <v-alert
            v-if="error"
            type="error"
            variant="tonal"
            density="compact"
            role="alert"
            >{{ error }}</v-alert
          >
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="loading"
            data-cy="openDialog-close"
            @click="open = false"
            >取消</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            type="submit"
            :loading="loading"
            :data-cy="
              mode === 'new' ? 'admin-newUser-submit' : 'openDialog-submit'
            "
            >保存</v-btn
          >
        </v-card-actions>
      </v-form>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, watch } from "vue";
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  mode: { type: String, default: "new" },
  username: { type: String, default: "" },
  initialEmail: { type: String, default: "" },
  loading: Boolean,
  error: { type: String, default: "" },
});
const emit = defineEmits(["save"]);
const titles = { new: "新建用户", email: "修改邮箱", password: "修改密码" };
const form = ref(null);
const newUsername = ref("");
const email = ref("");
const password = ref("");
const requiredRules = [(value) => Boolean(value?.trim()) || "此项为必填项"];
const emailRules = [
  (value) =>
    !value ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
    "请输入有效的邮箱地址",
];

watch(open, (value) => {
  password.value = "";
  if (value) {
    newUsername.value = "";
    email.value = props.initialEmail;
  }
});
const submit = async () => {
  if (props.loading || !(await form.value.validate()).valid) return;
  const values = {
    username: props.mode === "new" ? newUsername.value.trim() : props.username,
  };
  if (props.mode !== "password") values.email = email.value.trim();
  if (props.mode !== "email") values.password = password.value;
  emit("save", values);
};
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
