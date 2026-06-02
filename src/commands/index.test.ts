import { describe, expect, it } from "vitest";

import {
  buildAskCommand,
  buildInitCommand,
  buildRepowikiCommand,
} from "./index";

describe("buildAskCommand", () => {
  it("routes all Design Lab asks to the design_lab agent", () => {
    const command = buildAskCommand("/tmp/project");

    expect(command.agent).toBe("design_lab");
    expect(command.description).toContain("Design Lab");
    expect(command.template).toContain("$input");
    expect(command.template).toContain("models");
    expect(command.template).toContain(
      "/tmp/project/.opencode/design-lab.json",
    );
    expect(command.template).toContain("single-agent workflow");
  });
});

describe("buildInitCommand", () => {
  it("creates the new models/default_variant config template", () => {
    const command = buildInitCommand("/tmp/project");

    expect(command.template).toContain('"models"');
    expect(command.template).toContain('"default_variant": "max"');
    expect(command.template).toContain('"variant": "xhigh"');
    expect(command.template).toContain('"variant": null');
    expect(command.template).not.toContain('"design_models"');
    expect(command.template).not.toContain('"review_models"');
    expect(command.template).not.toContain('"ask_models"');
  });
});

describe("command config access", () => {
  it("includes user-level config fallback in runtime command prompts", () => {
    const commands = [
      buildAskCommand("/tmp/project"),
      buildRepowikiCommand("/tmp/project"),
    ];

    expect(commands[0].template).toContain("/tmp/project/.opencode/design-lab");
    expect(commands[0].template).toContain("user-level");
    expect(commands[0].template).toContain(".config/opencode/design-lab.json");
  });
});
