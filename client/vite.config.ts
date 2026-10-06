import { defineConfig } from "vite";

// Phaser goes in its own chunk (it's most of the download, and it rarely changes, so browsers keep it cached).
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: { output: { manualChunks: { phaser: ["phaser"] } } },
  },
});
