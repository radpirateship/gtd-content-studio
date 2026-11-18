// GTD brand-voice shim. The revamp generate pipeline expects buildBrandVoicePrompt();
// GTD's single source of voice truth is lib/brandRules.ts, so we delegate to it.
import { WRITING_RULES } from "@/lib/brandRules";

export const DEFAULT_BRAND_VOICE = WRITING_RULES;

export function buildBrandVoicePrompt(customRules?: string | null): string {
  return customRules && customRules.trim().length > 0
    ? `${WRITING_RULES}\n\nADDITIONAL RULES:\n${customRules.trim()}`
    : WRITING_RULES;
}
