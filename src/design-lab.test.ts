import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  loadPluginConfig: vi.fn(() => ({
    models: [
      "openai/gpt-5.2-codex",
      { model: "anthropic/claude-opus-4-5", variant: "xhigh" },
      { model: "local/model-without-variant", variant: null },
    ],
    default_variant: "max",
    base_output_dir: ".design-lab",
  })),
}));

vi.mock("./utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { DesignLab } from "./design-lab";

describe("DesignLab plugin registration", () => {
  it("registers the single design_lab primary and configured model subagents", async () => {
    const hooks = await DesignLab({
      directory: "/tmp/project",
    } as Parameters<typeof DesignLab>[0]);
    const config = {} as Parameters<NonNullable<typeof hooks.config>>[0];

    await hooks.config?.(config);

    expect(config.command?.["design-lab:ask"]?.agent).toBe("design_lab");
    expect(config.command?.["design-lab:init"]).toBeDefined();
    expect(config.command?.["design-lab:journal"]).toBeDefined();
    expect(config.command?.["design-lab:repowiki"]?.agent).toBe("design_lab");
    expect(config.command?.["design-lab:design"]).toBeUndefined();
    expect(config.command?.["design-lab:review"]).toBeUndefined();
    expect(config.command?.["design-lab:synthesize"]).toBeUndefined();

    const agents = config.agent!;
    expect(agents.design_lab).toBeDefined();
    expect("model" in agents.design_lab!).toBe(false);
    expect(agents.design_lab?.prompt).toContain("Current-code review workflow");
    expect(agents.designer).toBeUndefined();
    expect(agents.multi_model).toBeUndefined();

    expect(agents.design_lab_model_gpt52codex?.model).toBe(
      "openai/gpt-5.2-codex",
    );
    expect(agents.design_lab_model_gpt52codex?.variant).toBe("max");
    expect(agents.design_lab_model_claudeopus45?.model).toBe(
      "anthropic/claude-opus-4-5",
    );
    expect(agents.design_lab_model_claudeopus45?.variant).toBe("xhigh");
    expect(agents.design_lab_model_modelwithoutvariant?.model).toBe(
      "local/model-without-variant",
    );
    expect("variant" in agents.design_lab_model_modelwithoutvariant!).toBe(
      false,
    );
  });
});
