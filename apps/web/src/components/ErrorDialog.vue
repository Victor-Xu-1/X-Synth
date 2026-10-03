<template>
    <v-alert v-if="errorObj.string_error !== undefined" style="white-space: pre-line" :text=errorObj.string_error
        type="error"></v-alert>
    <v-expansion-panels variant="popout" class="my-4" :model-value="opened">
        <v-expansion-panel title="错误详情">
            <v-expansion-panel-text>
                <pre style="white-space: pre-wrap">{{ errorObj }}</pre>
            </v-expansion-panel-text>
        </v-expansion-panel>
    </v-expansion-panels>
</template>

<script>
export default {
    name: "SolubilityError",
    props: {
        errorObj: {
            type: Object,
            default: () => ({}),
        },
    },
    computed: {
        opened() { return (this.errorObj.string_error !== undefined ? -1 : 0) }
    }
}
</script>
