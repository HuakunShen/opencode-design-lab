import type { Plugin } from "@opencode-ai/plugin";

export const DesignLab: Plugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}) => {
  console.log("DesignLab");
  return {};
};
