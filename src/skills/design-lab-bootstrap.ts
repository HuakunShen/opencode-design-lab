export const DESIGN_LAB_AUTO_TRIGGER_TAG = "DESIGN_LAB_AUTO_TRIGGER";

type MessagePart = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};

type ChatMessage = {
  info?: { role?: string };
  parts?: MessagePart[];
};

type ChatMessagesTransformOutput = {
  messages: ChatMessage[];
};

const DESIGN_LAB_TRIGGER_PATTERNS = [
  /\bmulti[-\s]?model\b/i,
  /\bmultiple\s+models\b/i,
  /\bask\s+all\s+models\b/i,
  /\bcompare\s+(?:ai\s+)?models?\b/i,
  /\bcompare\s+model\s+plans?\b/i,
  /\bblind\s+review\b/i,
  /\banonymous\s+review\b/i,
  /\bcurrent[-\s]?code\s+review\b/i,
  /\breview\s+current\s+(?:code\s+)?changes\b/i,
  /多模型/,
  /多个模型/,
  /多\s*agent/i,
  /多模型设计/,
  /多模型评审/,
  /盲审/,
  /匿名评审/,
  /评审当前代码/,
  /评审当前改动/,
];

const DESIGN_LAB_NUDGE = `<${DESIGN_LAB_AUTO_TRIGGER_TAG}>
The user's request appears to match OpenCode Design Lab.
Use the OpenCode skill tool to load \`design-lab\` before proceeding.
Stay in the current agent; do not ask the user to switch agents.
If you are already \`design_lab\`, do not load this skill or delegate back to
\`design_lab\`; run the workflow directly.
After loading the skill, stay in the current agent and call \`task\` directly for each \`design_lab_model_*\` agent selected by the workflow, using that model agent name as the \`subagent_type\`. Do not call \`task\` with \`design_lab\` from the current/default agent, because that hides model workers one level down. Each model worker should appear as a top-level task card. The loaded skill owns model selection, output paths, manifests, and synthesis. Fallback: use \`design_lab_run\` only when native Task tool fanout is unavailable.
</${DESIGN_LAB_AUTO_TRIGGER_TAG}>`;

/**
 * Detect prompts that should nudge the current agent to load the Design Lab skill.
 */
export function shouldInjectDesignLabSkillNudge(text: string): boolean {
  return DESIGN_LAB_TRIGGER_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Prepend a Superpowers-style skill nudge to matching first user messages.
 */
export function injectDesignLabSkillNudge(
  output: ChatMessagesTransformOutput,
): void {
  if (!output.messages.length) {
    return;
  }

  const latestUser = findLatestUserMessage(output.messages);
  if (!latestUser?.parts?.length) {
    return;
  }

  if (latestUser.parts.some(isDesignLabNudgePart)) {
    return;
  }

  const userText = latestUser.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  if (!shouldInjectDesignLabSkillNudge(userText)) {
    return;
  }

  const ref = latestUser.parts[0];
  latestUser.parts.unshift({ ...ref, type: "text", text: DESIGN_LAB_NUDGE });
}

function findLatestUserMessage(
  messages: ChatMessage[],
): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info?.role === "user") {
      return messages[index];
    }
  }
  return undefined;
}

function isDesignLabNudgePart(part: MessagePart): boolean {
  return (
    part.type === "text" &&
    typeof part.text === "string" &&
    part.text.includes(DESIGN_LAB_AUTO_TRIGGER_TAG)
  );
}
