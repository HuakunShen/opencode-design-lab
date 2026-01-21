import { defineConfig } from "tsdown";

export default defineConfig({
  exports: true,
  dts: false,
  fixedExtension: false,
  outDir: ".opencode/plugins",
  entry: "./src/design-lab.ts",
});
