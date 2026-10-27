import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { transformSync } from "esbuild";
import { buildWorkers } from "./scripts/build-workers.mjs";
import { uiNotices } from "./scripts/ui-notices.mjs";

export default defineConfig({
  root: "frontend",
  base: "./",
  publicDir: "../public",
  resolve: { alias: { "/src": resolve("src"), "@": resolve("src") } },
  plugins: [
    {
      name: "calculation-workers",
      configureServer(server) {
        server.watcher.add([resolve("src/engine"), resolve("src/workers")]);
        let queued = Promise.resolve();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const changed = (file: string) => {
          if (!/\/src\/(engine|workers)\//.test(file.replaceAll("\\", "/")))
            return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            queued = queued
              .then(async () => {
                await buildWorkers();
                server.ws.send({ type: "full-reload" });
              })
              .catch((error) => server.config.logger.error(String(error)));
          }, 100);
        };
        server.watcher.on("change", changed).on("add", changed);
        server.httpServer?.once("close", () => {
          clearTimeout(timer);
          server.watcher.off("change", changed).off("add", changed);
        });
      },
    },
    {
      name: "browser-engine",
      enforce: "pre",
      transform(source, id) {
        if (
          !id.replaceAll("\\", "/").includes("/src/engine/") ||
          !id.endsWith(".js")
        )
          return;
        // UMD исходники сохраняем побайтно. Для браузера выбираем их browser-ветку
        // до обработки Vite: иначе CommonJS interop оставляет require в браузере.
        return {
          code: transformSync(source, {
            loader: "js",
            target: "es2022",
            minifySyntax: true,
            define: { module: "undefined", exports: "undefined" },
            sourcemap: false,
          }).code,
          map: null,
        };
      },
    },
    react(),
    tailwindcss(),
    uiNotices(),
  ],
  build: {
    outDir: "../hospital-map",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        viewer: resolve("frontend/index.html"),
        developer: resolve("frontend/developer.html"),
      },
    },
  },
});
