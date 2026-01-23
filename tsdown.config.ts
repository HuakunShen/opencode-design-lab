import { defineConfig } from "tsdown";

export default defineConfig({
  exports: false,
  dts: false,
  fixedExtension: false,
  outDir: ".opencode/plugins",
  entry: "./src/design-lab.ts",
  noExternal: ["pino", "zod"],
});
