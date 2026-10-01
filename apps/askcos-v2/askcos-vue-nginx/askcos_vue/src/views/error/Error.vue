<!-- path/to/src/components/ErrorPage.vue -->
<template>
    <v-container>
      <v-row justify="center" align="center">
        <v-col cols="12" md="6">
          <v-card>
            <v-card-title class="headline">Service Unavailable</v-card-title>
            <v-card-text>
              <p>We're sorry, but the server is currently unavailable. Please try again later.</p>
            </v-card-text>
            <v-card-actions>
              <v-btn @click="reload">Reload Page</v-btn>
            </v-card-actions>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </template>
  
  <script>
  export default {
    methods: {
      reload() {
        window.location.reload();
      }
    }
  }
  </script>
  
  <style scoped>
  /* Add any custom styles here */
  </style>