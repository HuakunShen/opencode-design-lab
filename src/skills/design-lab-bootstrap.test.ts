import { describe, expect, it } from "vitest";

import {
  DESIGN_LAB_AUTO_TRIGGER_TAG,
  injectDesignLabSkillNudge,
  shouldInjectDesignLabSkillNudge,
} from "./design-lab-bootstrap";

function makeOutput(text: string) {
  return {
    messages: [
      {
        info: { role: "user" },
        parts: [{ type: "text", text }],
      },
    ],
  };
}

describe("Design Lab skill bootstrap", () => {
  it("detects English multi-model Design Lab requests", () => {
    expect(
      shouldInjectDesignLabSkillNudge(
        "Please run a multi-model design review for the latest plan.",
      ),
    ).toBe(true);
    expect(
      shouldInjectDesignLabSkillNudge(
        "Ask all models to blind review the current code changes.",
      ),
    ).toBe(true);
  });

  it("detects Chinese multi-model Design Lab requests", () => {
    expect(
      shouldInjectDesignLabSkillNudge(
        "帮我做一个多模型设计，然后让多个模型盲审",
      ),
    ).toBe(true);
    expect(shouldInjectDesignLabSkillNudge("评审当前代码，用多个模型")).toBe(
      true,
    );
  });

  it("ignores ordinary prompts", () => {
    expect(shouldInjectDesignLabSkillNudge("Fix this TypeScript error.")).toBe(
      false,
    );
  });

  it("injects a single skill-tool nudge into matching first user messages", () => {
    const output = makeOutput("Compare this plan with multiple models.");

    injectDesignLabSkillNudge(output);
    injectDesignLabSkillNudge(output);

    const triggerParts = output.messages[0].parts.filter(
      (part) =>
        part.type === "text" && part.text.includes(DESIGN_LAB_AUTO_TRIGGER_TAG),
    );

    expect(triggerParts).toHaveLength(1);
    expect(triggerParts[0].text).toContain("skill");
    expect(triggerParts[0].text).toContain("design-lab");
    expect(triggerParts[0].text).toContain("already `design_lab`");
    expect(triggerParts[0].text).toContain("Task tool");
    expect(triggerParts[0].text).toContain("subagent_type");
    expect(triggerParts[0].text).toContain(
      "call `task` directly for each `design_lab_model_*`",
    );
    expect(triggerParts[0].text).toContain("top-level task card");
    expect(triggerParts[0].text).toMatch(
      /the loaded skill owns model selection, output paths, manifests, and synthesis/i,
    );
    expect(triggerParts[0].text).not.toContain('subagent_type: "design_lab"');
    expect(triggerParts[0].text).not.toContain("delegate_task");
    expect(triggerParts[0].text).toMatch(/fallback[\s\S]*design_lab_run/i);
    expect(triggerParts[0].text).not.toContain(
      "prefer the `design_lab_run` tool",
    );
    expect(output.messages[0].parts.at(-1)?.text).toBe(
      "Compare this plan with multiple models.",
    );
  });

  it("injects into the latest matching user message in an existing session", () => {
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "First, fix this TypeScript error." }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: "I fixed it." }],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Now ask all models to review this." }],
        },
      ],
    };

    injectDesignLabSkillNudge(output);

    expect(output.messages[0].parts[0].text).toBe(
      "First, fix this TypeScript error.",
    );
    expect(output.messages[2].parts[0].text).toContain(
      DESIGN_LAB_AUTO_TRIGGER_TAG,
    );
    expect(output.messages[2].parts[1].text).toBe(
      "Now ask all models to review this.",
    );
  });
});
