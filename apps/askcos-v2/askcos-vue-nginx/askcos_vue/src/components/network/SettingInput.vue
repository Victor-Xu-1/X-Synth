<template>
  <v-row class="align-center">
    <v-col :cols="labelCols" class="pa-0">
      <v-tooltip v-if="helpText" max-width="200px" location="bottom">
        <template v-slot:activator="{ props }">
          <v-icon v-bind="props" size="x-small">mdi-information</v-icon>
        </template>
        <span>{{ helpText }}</span>
      </v-tooltip>
      {{ label }}
    </v-col>
    <v-col class="pa-0">
      <slot></slot>
    </v-col>
  </v-row>
</template>

<script>
export default {
  name: 'SettingInput',
  props: {
    helpText: {
      type: String,
      default: '',
    },
    label: {
      type: String,
      default: ''
    },
    labelCols: {
      type: Number,
      default: 6
    },
  },
}
</script>
