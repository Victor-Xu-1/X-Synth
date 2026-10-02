<template>
    <div class="synon-workbench-shell">
        <launch-pad />
    </div>
</template>

<script setup>
import LaunchPad from "@/components/home/Launchpad";
</script>

<style scoped>
.synon-workbench-shell {
    height: 100%;
    min-height: 0;
    background: transparent;
    box-shadow: none;
    overflow: visible;
}

@media (max-width: 960px) {
    .synon-workbench-shell {
        height: auto;
    }
}
</style>
