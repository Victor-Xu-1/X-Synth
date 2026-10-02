<template>
    <v-expansion-panels class="mb-2 text-body-1" :color="isDark ? 'grey-darken-3' : 'grey-lighten-3'">
        <v-expansion-panel text='本软件按“现状”提供，不对适销性、特定用途适用性或其他明示、默示保证作承诺。因使用本软件造成的任何直接、间接、偶然、特殊、惩罚性或后果性损失，软件贡献者均不承担责任。'
            :class="isDark ? 'bg-grey-darken-3' : 'bg-grey-lighten-3'">
            <template v-slot:title>
                <v-icon class="mr-1">mdi-license</v-icon>
                <strong>许可说明</strong>
            </template>
        </v-expansion-panel>
        <v-expansion-panel :class="isDark ? 'bg-grey-darken-3' : 'bg-grey-lighten-3'">
            <template v-slot:title>
                <v-icon class="mr-1">mdi-account-group</v-icon>
                <strong>贡献者</strong>
            </template>
            <template v-slot:text>
                <v-chip class="ma-1" v-for="person in contributorList" :key="person">
                    <v-icon start icon="mdi-account"></v-icon>
                    <span class="text-body-1">{{ person }}</span>
                </v-chip>
            </template>
        </v-expansion-panel>
    </v-expansion-panels>
</template>

<script setup>
import { ref } from "vue";
import { useTheme } from "@/composables/useTheme";

const { isDark } = useTheme();

const contributorList = ref([
    "Zhenkgai Tu (Maintainer)",
    "Sourabh Choure (Maintainer)",
    "Max Liu",
    "Samuel Gong",
    "Mun Hong Fong",
    "Aaron Chen",
    "Tony Li",
    "Mike Fortunato",
    "Pritha Verma",
    "Thomas Struble",
    "David Graff",
    "Itai Levin",
    "Jiannan Liu",
    "Hanyu Gao",
    "Yunsie Chung",
    "Florence Vermeire",
    "Yiming Mo",
    "Thijs Stuyver",
    "Yanfei Guan",
    "Travis Nevins",
    "Joonyoung Joung",
    "Huiqian Lin",
    "Mark Murnin",
    "Connor Coley"
])
</script>
