<template>
  <div class="d-flex justify-center align-center" style="height: 100vh">
    <v-container>
      <v-row justify="center">
        <v-col cols="12" md="6" lg="4">
          <v-card>
            <v-card-text class="text-center pa-8">
              <v-progress-circular indeterminate color="primary" size="64" class="mb-4"></v-progress-circular>
              <h2 class="text-h5">Signing you out...</h2>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

onMounted(async () => {
  try {
    // Notify parent window that logout is complete - parent will close this popup
    if (window.opener) {
      window.opener.postMessage(
        { type: "kc-logout-success" },
        window.location.origin
      );
      // Parent window will close this popup, so we just wait
      return;
    }
    // If not a popup, route this window to login
    router.push("/login");
  } catch (e) {
    console.debug(e);
  }
});
</script>
