<template>
    <v-main style="background-color: #f0f2f5">
        <router-view v-slot="{ Component }">
            <keep-alive>
                <component :is="Component" />
            </keep-alive>
        </router-view>
    </v-main>
</template>

<script setup>

</script>