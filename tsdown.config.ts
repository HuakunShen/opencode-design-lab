import { defineConfig } from "tsdown";

export default defineConfig({
  exports: true,
  format: ["esm"],
  outDir: ".opencode/plugins",
  dts: false,
  fixedExtension: false,
  target: "esnext",
  entry: ["src/index.ts"],
  external: ["@opencode-ai/plugin", "@opencode-ai/sdk"],
});
