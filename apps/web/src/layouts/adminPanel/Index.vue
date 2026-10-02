<template>
    <v-app class="overflow-auto">
        <v-layout style="min-width: 1150px; height:100vh">
            <app-bar />
            <admin-view />
        </v-layout>
    </v-app>
</template>
<script setup>
import AppBar from "./AppBar.vue";
import AdminView from "./View.vue";
</script>