<template>
    <v-row class="justify-center">
        <v-col cols="12" md="12" xl="10">
            <div class="my-4">
                <v-app-bar>
                    <v-app-bar-title>
                        <v-breadcrumbs class="pa-0 text-body-1" :items="breadCrumbItems">
                        </v-breadcrumbs>
                    </v-app-bar-title>
                </v-app-bar>
                <h4 class="text-h4 text-primary">
                    {{ props.pageTitle }}
                </h4>
            </div>
        </v-col>
    </v-row>
</template>

<script setup>
import { useRoute } from 'vue-router';
const route = useRoute();
const breadCrumbItems = [{ title: '工作台', to: "/" }, { title: route.meta.title }]
const props = defineProps({ pageTitle: { type: String, required: true } })
</script>
