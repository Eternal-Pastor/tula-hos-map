import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

// Include notices for packages that contribute code to the shipped chunks.
export function uiNotices() {
  return {
    name: "ui-license-notices",
    async generateBundle(_options, bundle) {
      const directories = new Set([
        resolve("node_modules/@fontsource-variable/geist"),
        resolve("node_modules/shadcn"),
      ]);
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, module] of Object.entries(output.modules)) {
          if (!module.renderedLength || id.includes("\0")) continue;
          const match = id
            .replaceAll("\\", "/")
            .match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)/);
          if (match) directories.add(match[1]);
        }
      }
      const sections = [];
      for (const directory of directories) {
        const pkg = JSON.parse(
          await readFile(resolve(directory, "package.json"), "utf8"),
        );
        const names = (await readdir(directory)).filter((name) =>
          /^(licen[cs]e|copying|notice)(\.|$)/i.test(name),
        );
        const licenses = await Promise.all(
          names.map(
            async (name) =>
              `${name}\n${await readFile(resolve(directory, name), "utf8")}`,
          ),
        );
        sections.push(
          `${pkg.name} ${pkg.version}\nLicense: ${pkg.license ?? "see notice"}\n${licenses.join("\n\n")}`,
        );
      }
      this.emitFile({
        type: "asset",
        fileName: "vendor/UI-NOTICES.txt",
        source: `UI components, icons, font and bundled dependencies.\nshadcn/ui: https://ui.shadcn.com/\n\n${sections.sort().join("\n\n----------------------------------------\n\n")}\n`,
      });
    },
  };
}
