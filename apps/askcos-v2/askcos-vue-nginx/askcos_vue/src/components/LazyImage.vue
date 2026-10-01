<template>
  <v-lazy>
    <v-img v-bind="$attrs">
      <slot></slot>
      <template v-if="$slots.error" #error>
        <slot name="error"></slot>
      </template>
      <template v-if="$slots.placeholder" #placeholder>
        <slot name="placeholder"></slot>
      </template>
    </v-img>
  </v-lazy>
</template>

<script>
export default {
  inheritAttrs: false,
};
</script>
