import { defineConfig } from "cypress";
import { rm } from "fs";

export default defineConfig({
  e2e: {
    // setupNodeEvents(on, config) {
    //   // implement node event listeners here
    // },
    setupNodeEvents(on) {
      //on('task', {downloadFile}),
      on('task', {
        deleteFolder(folderName) {
          return new Promise((resolve) => {
            rm(folderName, { maxRetries: 10, recursive: true, force: true }, (err) => {
              if (err && err.code !== "ENOENT") {
                console.error(err)
              }
              resolve(null)
            })
          })
        }
      })
    },
    baseUrl: 'http://localhost:3000',
    experimentalStudio: true,
    numTestsKeptInMemory: 50,
    chromeWebSecurity: false,
    experimentalMemoryManagement: true,
  },
});
