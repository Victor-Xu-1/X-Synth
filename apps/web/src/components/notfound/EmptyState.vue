<template>
    <v-row class="justify-center">
        <v-col cols="12" md="10" class="d-flex justify-center text-center">
            <v-empty-state title="页面未找到" text="当前地址不属于已知的工作台页面，请返回工作台重新选择功能。"
                :image="pageNotFoundSrc">
                <template v-slot:actions>
                    <v-btn variant="tonal" to="/">返回工作台</v-btn>
                </template>
            </v-empty-state>
        </v-col>
    </v-row>
</template>

<script setup>
import { ref } from 'vue'
import pageNotFound from "@/assets/pageNotFound.svg";

const pageNotFoundSrc = ref(pageNotFound)
</script>
