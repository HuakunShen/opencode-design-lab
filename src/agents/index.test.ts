import { describe, expect, it } from "vitest";

import {
  createDesignLabModelAgent,
  createDesignLabPrimaryAgent,
  getDesignLabSubagentName,
  normalizeModelConfig,
} from "./index";

describe("design_lab agents", () => {
  it("builds stable design_lab subagent names", () => {
    expect(getDesignLabSubagentName("openai/gpt-5.2-codex")).toBe(
      "design_lab_model_gpt52codex",
    );
  });

  it("normalizes string model configs with the default variant", () => {
    expect(normalizeModelConfig("openai/gpt-5.2-codex", "xhigh")).toEqual({
      model: "openai/gpt-5.2-codex",
      variant: "xhigh",
    });
  });

  it("preserves explicit null variants", () => {
    expect(
      normalizeModelConfig(
        { model: "local/model-without-variant", variant: null },
        "max",
      ),
    ).toEqual({
      model: "local/model-without-variant",
      variant: null,
    });
  });

  it("creates a coordinator agent that can run directly or through delegation", () => {
    const agent = createDesignLabPrimaryAgent({
      baseOutputDir: ".design-lab",
      models: [
        {
          model: "openai/gpt-5.2-codex",
          variant: "xhigh",
          agentName: "design_lab_model_gpt52codex",
          fileStem: "gpt-5-2-codex",
        },
      ],
    });

    expect(agent.mode).toBe("all");
    expect("model" in agent).toBe(false);
    expect(agent.prompt).toContain("Direct agent usage");
    expect(agent.prompt).toContain("Plan workflow");
    expect(agent.prompt).toContain("Revision workflow");
    expect(agent.prompt).toContain("Blind review workflow");
    expect(agent.prompt).toContain("Current-code review workflow");
    expect(agent.prompt).toContain("Reviewer selection");
    expect(agent.prompt).toContain("design_lab_model_gpt52codex");
    expect(agent.prompt).toContain("variant: xhigh");
    expect(agent.tools?.task).toBe(true);
    expect(agent.tools).not.toHaveProperty("delegate_task");
    expect(agent.permission?.edit).toBe("allow");
  });

  it("creates a subagent with arbitrary variants", () => {
    const agent = createDesignLabModelAgent("openai/gpt-5.2-codex", "xhigh");

    expect(agent.mode).toBe("subagent");
    expect(agent.model).toBe("openai/gpt-5.2-codex");
    expect(agent.variant).toBe("xhigh");
    expect(agent.prompt).toContain("design_lab coordinator or current agent");
    expect(agent.prompt).not.toContain(
      "only from the design_lab primary agent",
    );
    expect(agent.prompt).toContain("ONLY write to the exact output_file");
    expect(agent.prompt).toContain("Never modify project source files");
    expect(agent.prompt).toContain("During code review tasks");
    expect(agent.prompt).toContain("WROTE: <output_file>");
    expect(agent.tools?.write).toBe(true);
    expect(agent.tools?.task).toBe(false);
    expect(agent.tools).not.toHaveProperty("delegate_task");
    expect(agent.permission?.bash).toBe("deny");
    expect(agent.permission?.edit).toBe("allow");
  });

  it("omits subagent variant when configured as null", () => {
    const agent = createDesignLabModelAgent(
      "local/model-without-variant",
      null,
    );

    expect(agent.model).toBe("local/model-without-variant");
    expect("variant" in agent).toBe(false);
  });
});
