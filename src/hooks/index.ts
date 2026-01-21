import * as path from "path";
import type { DesignLabConfig } from "../config/schema";

export interface DesignIsolationHookOptions {
  baseDir: string;
  enabled: boolean;
}

export interface DesignIsolationHook {
  "tool.execute.before": (
    input: { tool: string; sessionID: string; callID: string },
    output: { args?: Record<string, unknown> },
  ) => void | Promise<void>;
}

export class DesignIsolationHook {
  private designsDir: string;
  private enabled: boolean;

  constructor(options: DesignIsolationHookOptions) {
    this.designsDir = path.join(options.baseDir, "designs");
    this.enabled = options.enabled;
  }

  isDesignPath(targetPath: string): boolean {
    const normalizedTarget = path.normalize(targetPath);
    const normalizedDesigns = path.normalize(this.designsDir);

    return normalizedTarget.startsWith(normalizedDesigns);
  }

  isAllowedRead(targetPath: string, currentDesignId?: string): boolean {
    if (!this.enabled) {
      return true;
    }

    if (!this.isDesignPath(targetPath)) {
      return true;
    }

    if (!currentDesignId) {
      return false;
    }

    const normalizedTarget = path.normalize(targetPath);
    const allowedPath = path.join(this.designsDir, currentDesignId);

    return normalizedTarget.startsWith(allowedPath);
  }

  getHandler(
    currentDesignId?: string,
  ): DesignIsolationHook["tool.execute.before"] {
    if (!this.enabled) {
      return async () => {};
    }

    return async (input, output) => {
      const tool = input.tool;
      const args = output.args as Record<string, unknown> | undefined;

      if (tool === "read" && args?.path) {
        const targetPath = args.path as string;
        if (!this.isAllowedRead(targetPath, currentDesignId)) {
          throw new Error(
            "Design isolation violation: Cannot read from other designs during design generation phase.",
          );
        }
      }

      if (tool === "write" && args?.path) {
        const targetPath = args.path as string;
        if (this.isDesignPath(targetPath)) {
          if (!currentDesignId) {
            throw new Error(
              "Design isolation violation: Cannot write to designs directory without a design ID.",
            );
          }
          const normalizedTarget = path.normalize(targetPath);
          const allowedPath = path.join(this.designsDir, currentDesignId);
          if (!normalizedTarget.startsWith(allowedPath)) {
            throw new Error(
              "Design isolation violation: Cannot write to other designs during design generation phase.",
            );
          }
        }
      }

      if (tool === "bash" || tool === "interactive_bash") {
        const command = args?.command as string | undefined;
        if (command) {
          const restrictedCommands = [
            "cd",
            "ls",
            "cat",
            "grep",
            "find",
            "rm",
            "cp",
            "mv",
          ];
          const firstWord = command.trim().split(/\s+/)[0];

          if (restrictedCommands.includes(firstWord)) {
            if (command.includes(this.designsDir) && !currentDesignId) {
              throw new Error(
                "Design isolation violation: Cannot access other designs using bash commands.",
              );
            }
          }
        }
      }
    };
  }
}

export function createDesignIsolationHook(
  config: DesignLabConfig,
  baseDir: string,
  currentDesignId?: string,
): DesignIsolationHook | null {
  const enabled = config.hooks?.design_isolation?.enabled ?? false;

  if (!enabled) {
    return null;
  }

  return new DesignIsolationHook({
    baseDir,
    enabled,
  });
}
