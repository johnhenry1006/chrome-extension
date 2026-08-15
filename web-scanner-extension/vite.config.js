import { defineConfig } from "vite";
import { resolve } from "node:path";

const entryNames = {
    background: "src/background/service-worker.js",
    content: "src/content/content.js",
    dbworker: "src/db-worker/sqlite-worker.js",
};

export default defineConfig({
    build: {
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: false,
        rollupOptions: {
            input: {
                background: resolve("src/background/service-worker.js"),
                content: resolve("src/content/content.js"),
                dbworker: resolve("src/db-worker/sqlite-worker.js"),
            },
            output: {
                entryFileNames(chunk) {
                    return entryNames[chunk.name] || `assets/${chunk.name}.js`;
                },
                chunkFileNames: "assets/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
    },
});
