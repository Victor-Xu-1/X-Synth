<template>
    <img :src="src" :style="style" @click="onClick" />
</template>

<script>
import { ref, reactive } from 'vue';

export default {
    name: "SciFindernButton",
    setup() {
        const src = ref('/static/img/CAS_SFn_Button.svg');
        const style = reactive({
            border: '1px solid #ffc72c',
            borderRadius: '0.25rem',
            backgroundColor: '#ffc72c'
        });

        return {
            src,
            style
        };
    },
};
</script>