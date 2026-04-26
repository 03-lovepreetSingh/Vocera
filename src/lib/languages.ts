/**
 * Language catalog for the Create-AI-Agent wizard and the voice pipeline.
 *
 * Each entry maps a BCP-47 code to:
 *   • a human label (UI),
 *   • a Deepgram code (STT) — Deepgram supports multilingual mode with `language=multi`,
 *     but you can also pin a single language for cleaner results.
 *   • a default ElevenLabs voice id — multilingual model `eleven_flash_v2_5` supports
 *     32 languages with the same voice; we pre-pick a sensible voice per region.
 */

export interface LanguageDef {
  /** BCP-47 code stored in the DB. */
  code: string;
  /** Display label in the wizard. */
  label: string;
  /** Native-script label, shown as a subtitle. */
  native: string;
  /** Deepgram language code for streaming STT. */
  deepgram: string;
  /** Default ElevenLabs voice id (Flash v2.5 multilingual). */
  elevenVoiceId: string;
}

// ElevenLabs voice IDs are stable strings. The ones below are well-known
// multilingual voices in the ElevenLabs free tier as of April 2026.
// Users can override per agent via `agent_versions.voice_map`.
const RACHEL = '21m00Tcm4TlvDq8ikWAM';
const BELLA = 'EXAVITQu4vr4xnSDxMaL';
const ANTONI = 'ErXwobaYiN019PkySvjV';
const ARNOLD = 'VR6AewLTigWG4xSOukaG';
const ADAM = 'pNInz6obpgDQGcFmaJgB';

export const LANGUAGES: readonly LanguageDef[] = [
  { code: 'en-US', label: 'English (US)', native: 'English', deepgram: 'en-US', elevenVoiceId: RACHEL },
  { code: 'en-GB', label: 'English (UK)', native: 'English', deepgram: 'en-GB', elevenVoiceId: BELLA },
  { code: 'en-IN', label: 'English (India)', native: 'English', deepgram: 'en-IN', elevenVoiceId: BELLA },
  { code: 'hi-IN', label: 'Hindi', native: 'हिन्दी', deepgram: 'hi', elevenVoiceId: BELLA },
  { code: 'es-ES', label: 'Spanish (Spain)', native: 'Español', deepgram: 'es', elevenVoiceId: BELLA },
  { code: 'es-MX', label: 'Spanish (Mexico)', native: 'Español', deepgram: 'es-419', elevenVoiceId: BELLA },
  { code: 'fr-FR', label: 'French', native: 'Français', deepgram: 'fr', elevenVoiceId: ANTONI },
  { code: 'de-DE', label: 'German', native: 'Deutsch', deepgram: 'de', elevenVoiceId: ARNOLD },
  { code: 'pt-BR', label: 'Portuguese (BR)', native: 'Português', deepgram: 'pt-BR', elevenVoiceId: ANTONI },
  { code: 'pt-PT', label: 'Portuguese (PT)', native: 'Português', deepgram: 'pt', elevenVoiceId: ANTONI },
  { code: 'it-IT', label: 'Italian', native: 'Italiano', deepgram: 'it', elevenVoiceId: ANTONI },
  { code: 'nl-NL', label: 'Dutch', native: 'Nederlands', deepgram: 'nl', elevenVoiceId: ARNOLD },
  { code: 'pl-PL', label: 'Polish', native: 'Polski', deepgram: 'pl', elevenVoiceId: ARNOLD },
  { code: 'tr-TR', label: 'Turkish', native: 'Türkçe', deepgram: 'tr', elevenVoiceId: ARNOLD },
  { code: 'ru-RU', label: 'Russian', native: 'Русский', deepgram: 'ru', elevenVoiceId: ARNOLD },
  { code: 'uk-UA', label: 'Ukrainian', native: 'Українська', deepgram: 'uk', elevenVoiceId: BELLA },
  { code: 'ar-SA', label: 'Arabic', native: 'العربية', deepgram: 'multi', elevenVoiceId: ADAM },
  { code: 'zh-CN', label: 'Chinese (Mandarin)', native: '中文', deepgram: 'zh-CN', elevenVoiceId: ADAM },
  { code: 'ja-JP', label: 'Japanese', native: '日本語', deepgram: 'ja', elevenVoiceId: ADAM },
  { code: 'ko-KR', label: 'Korean', native: '한국어', deepgram: 'ko', elevenVoiceId: ADAM },
  { code: 'id-ID', label: 'Indonesian', native: 'Bahasa Indonesia', deepgram: 'id', elevenVoiceId: ADAM },
  { code: 'vi-VN', label: 'Vietnamese', native: 'Tiếng Việt', deepgram: 'vi', elevenVoiceId: ADAM },
  { code: 'th-TH', label: 'Thai', native: 'ไทย', deepgram: 'th', elevenVoiceId: ADAM },
  { code: 'sv-SE', label: 'Swedish', native: 'Svenska', deepgram: 'sv', elevenVoiceId: ARNOLD },
] as const;

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));
export function getLanguage(code: string): LanguageDef | undefined {
  return byCode.get(code);
}

/**
 * Build the default `voice_map` for an agent given its language list.
 * One ElevenLabs voice id per language — users can override later.
 */
export function defaultVoiceMap(codes: readonly string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const code of codes) {
    const def = byCode.get(code);
    if (def) map[code] = def.elevenVoiceId;
  }
  return map;
}

/**
 * Pick the right Deepgram language hint:
 *   • If only one language is enabled, use its specific code (best accuracy).
 *   • If many, return 'multi' (Deepgram auto-detects across enabled languages).
 *   • Fall back to 'en-US'.
 */
export function deepgramLanguage(codes: readonly string[]): string {
  if (codes.length === 1) return byCode.get(codes[0])?.deepgram ?? 'en-US';
  if (codes.length > 1) return 'multi';
  return 'en-US';
}
