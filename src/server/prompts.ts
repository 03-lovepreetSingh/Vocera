/**
 * Prompt assembly. Per PRD §4.1: starter system prompts per purpose,
 * then a Context block from the user's free-text refinement.
 *
 * Multilingual instruction is appended every time so the agent always
 * mirrors the caller's language and stays in the supported set.
 */

const PURPOSE_PROMPTS: Record<string, string> = {
  support: `You are a customer-support voice/chat agent. Be concise, warm, and accurate. \
If the answer is in the provided <context>, ground your response in it and cite \
specific facts. If the answer is not in the context, say "I don't have that \
information yet — let me get a human to help" instead of guessing.`,
  'lead-qual': `You are a lead-qualification agent. Politely gather the structured \
information the user is willing to share, in a conversational way (not a survey). \
Capture name, contact, intent, and urgency without making the caller feel \
interrogated.`,
  booking: `You are an appointment-booking agent. Confirm the caller's intent, \
offer 2-3 viable time slots, and book the first one they accept. Read back the \
booking details before ending the call.`,
  ivr: `You are an inbound IVR agent. Handle requests in natural language — never \
say "press 1 for…". Route or resolve in one or two turns whenever possible.`,
  outbound: `You are an outbound calling agent. State the purpose of the call in the \
first sentence, give the recipient a clear opt-out, and proceed only with explicit \
consent.`,
  custom: `You are a helpful AI agent. Follow the operator's instructions strictly \
and ground answers in the provided <context>.`,
};

interface BuildPromptInput {
  purpose: string;
  industry?: string | null;
  audience?: string | null;
  description?: string | null;
  freeText?: string | null;
  languages: readonly string[];
  defaultLanguage: string;
}

export function buildSystemPrompt(input: BuildPromptInput): string {
  const base = PURPOSE_PROMPTS[input.purpose] ?? PURPOSE_PROMPTS.custom;
  const lines: string[] = [base];

  if (input.industry) lines.push(`Industry: ${input.industry}.`);
  if (input.audience) lines.push(`Primary audience: ${input.audience}.`);
  if (input.description?.trim()) lines.push(`About this business:\n${input.description.trim()}`);
  if (input.freeText?.trim()) lines.push(`Operator notes:\n${input.freeText.trim()}`);

  // Multilingual rule — always last, so it overrides any earlier language hints.
  if (input.languages.length === 1) {
    lines.push(`Always respond in ${input.languages[0]}.`);
  } else {
    lines.push(
      `You are a multilingual agent. Supported languages: ${input.languages.join(', ')}. \
Always respond in the same language the user just used. If the user speaks a language \
NOT in the supported list, politely apologize in ${input.defaultLanguage} and offer to \
continue in one of the supported languages.`,
    );
  }

  lines.push(
    `Knowledge grounding: when a <context>...</context> block is present, treat it \
as the source of truth. Do not invent facts. If the context is silent on a question, \
say so plainly.`,
  );
  lines.push(
    `Voice style: keep replies short (1-3 sentences) and conversational. Avoid markdown.`,
  );

  return lines.join('\n\n');
}
