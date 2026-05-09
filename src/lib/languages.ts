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
 * Localized greetings — written to sound like a real person picking up a phone,
 * each ending with an open prompt that invites the user to share their issue.
 * Falls back to English if the language isn't in the table.
 */
const GREETINGS: Record<string, string> = {
  'en-US': "Hey there — thanks for calling. What's going on?",
  'en-GB': "Hello — you've got me. What can I sort out for you?",
  'en-IN': "Hello! Glad you called. Tell me what's on your mind.",
  'hi-IN': 'नमस्ते! बताइए, मैं किस बारे में मदद करूँ?',
  'es-ES': '¡Hola! Cuéntame, ¿qué necesitas?',
  'es-MX': '¡Hola! Dime, ¿en qué te echo la mano?',
  'fr-FR': 'Bonjour ! Dites-moi, qu’est-ce qui vous amène ?',
  'de-DE': 'Hallo! Schön, dass Sie anrufen — worum geht’s?',
  'pt-BR': 'Oi! Fala comigo, o que está acontecendo?',
  'pt-PT': 'Olá! Diga-me, em que posso ajudar?',
  'it-IT': 'Ciao! Dimmi pure, di cosa hai bisogno?',
  'nl-NL': 'Hoi! Vertel, wat kan ik voor je doen?',
  'ja-JP': 'はい、お電話ありがとうございます。どうされましたか？',
  'ko-KR': '안녕하세요, 전화 주셔서 감사합니다. 어떤 일이세요?',
  'zh-CN': '您好，谢谢来电，请问遇到什么情况了？',
  'ar-SA': 'أهلاً بك، تفضّل، كيف أقدر أساعدك؟',
  'tr-TR': 'Merhaba! Anlatın bakalım, nasıl yardımcı olabilirim?',
  'ru-RU': 'Здравствуйте! Слушаю вас, что случилось?',
  'id-ID': 'Halo! Cerita dong, ada masalah apa?',
  'vi-VN': 'Xin chào! Bạn cứ kể, tôi đang nghe đây.',
  'th-TH': 'สวัสดีค่ะ เล่ามาเลยค่ะ มีเรื่องอะไรคะ?',
  'sv-SE': 'Hej! Berätta, vad gäller saken?',
  'pl-PL': 'Cześć! Powiedz, w czym problem?',
  'uk-UA': 'Вітаю! Розкажіть, у чому справа?',
};

/** Pool of varied en-US openers — picked at random per session for variety. */
const EN_US_GREETINGS = [
  "Hey there — thanks for calling. What's going on?",
  "Hi! Glad you reached out. What can I help you figure out?",
  "Hey, you've got me. Tell me what's up.",
  "Hi there — what's on your mind today?",
];

export function greetingFor(language: string): string {
  if (language === 'en-US') {
    return EN_US_GREETINGS[Math.floor(Math.random() * EN_US_GREETINGS.length)];
  }
  return GREETINGS[language] ?? GREETINGS['en-US'];
}

/**
 * Short "thinking" fillers played during the LLM warmup gap so the user
 * doesn't sit in dead silence while the agent's first token arrives.
 */
export const FILLERS: Record<string, string[]> = {
  'en-US': [
    'Hmm, let me think.',
    'Sure, one moment.',
    'Okay, just a sec.',
    'Right, give me a second.',
    'Got it, checking now.',
  ],
  'en-GB': ['Hmm, one moment.', "Right, let's see.", 'Okay, just a tick.'],
  'en-IN': ['Hmm, ek second.', 'Sure, just a moment.', 'Okay, let me check.'],
  'hi-IN': ['Hmm, ek second.', 'Theek hai, dekhta hoon.', 'Achha, abhi batata hoon.'],
  'es-ES': ['Mmm, un momento.', 'Vale, déjame ver.', 'Sí, un segundo.'],
  'es-MX': ['Mmm, un momentito.', 'Órale, déjame ver.', 'Sí, un segundo.'],
  'fr-FR': ['Hmm, un instant.', "D'accord, voyons voir.", 'Oui, une seconde.'],
  'de-DE': ['Hmm, einen Moment.', 'Okay, mal schauen.', 'Ja, eine Sekunde.'],
  'pt-BR': ['Hmm, um momento.', 'Tá, deixa eu ver.', 'Sim, um segundinho.'],
  'it-IT': ['Mmm, un attimo.', 'Va bene, fammi vedere.', 'Sì, un secondo.'],
  'ja-JP': ['えっと、少々お待ちください。', 'はい、すぐに確認します。'],
  'zh-CN': ['嗯，稍等一下。', '好的，让我看看。'],
};

export function pickFiller(language: string): string {
  const list = FILLERS[language] ?? FILLERS['en-US'];
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Detect the dominant language of a piece of text by Unicode script.
 * Used to route TTS correctly when the LLM code-switches mid-conversation
 * (e.g., user asks in English to switch to Hindi, agent replies in Devanagari).
 *
 * Returns a BCP-47 code matching one of our LANGUAGES list, or `fallback` if
 * no non-Latin script is dominant. Latin script returns `fallback` because we
 * can't distinguish English from French/Spanish/German by script alone.
 */
export function detectLanguageFromText(text: string, fallback = 'en-US'): string {
  if (!text) return fallback;
  const counts = {
    devanagari: 0, // hi-IN
    cjkUnified: 0, // zh-CN (also Japanese kanji — disambiguated by hiragana below)
    hiraganaKatakana: 0, // ja-JP
    hangul: 0, // ko-KR
    cyrillic: 0, // ru-RU / uk-UA
    arabic: 0, // ar-SA
    thai: 0, // th-TH
    greek: 0, // el (not in our catalog, but detect)
    latin: 0,
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x0900 && c <= 0x097f) counts.devanagari++;
    else if (c >= 0x4e00 && c <= 0x9fff) counts.cjkUnified++;
    else if ((c >= 0x3040 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff))
      counts.hiraganaKatakana++;
    else if (c >= 0xac00 && c <= 0xd7af) counts.hangul++;
    else if (c >= 0x0400 && c <= 0x04ff) counts.cyrillic++;
    else if (c >= 0x0600 && c <= 0x06ff) counts.arabic++;
    else if (c >= 0x0e00 && c <= 0x0e7f) counts.thai++;
    else if (c >= 0x0370 && c <= 0x03ff) counts.greek++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) counts.latin++;
  }

  // Japanese: presence of any hiragana/katakana strongly indicates Japanese,
  // even alongside CJK kanji. Check this first.
  if (counts.hiraganaKatakana > 0) return 'ja-JP';
  if (counts.hangul > 0) return 'ko-KR';
  if (counts.devanagari > Math.max(2, counts.latin / 4)) return 'hi-IN';
  if (counts.cjkUnified > Math.max(2, counts.latin / 4)) return 'zh-CN';
  if (counts.cyrillic > Math.max(2, counts.latin / 4)) return 'ru-RU';
  if (counts.arabic > Math.max(2, counts.latin / 4)) return 'ar-SA';
  if (counts.thai > Math.max(2, counts.latin / 4)) return 'th-TH';
  // Latin-script languages can't be reliably distinguished by script alone
  // (English vs Spanish vs French look the same). Fall back to caller's hint.
  return fallback;
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

/**
 * Map a Deepgram-detected language code back to the agent's enabled BCP-47
 * code. Deepgram's `language=multi` mode returns ISO 639-1 short codes
 * (`'hi'`, `'en'`, `'es'`) — but our agent config and voiceMap use BCP-47
 * locales (`'hi-IN'`, `'en-US'`, `'es-MX'`). Without normalization,
 * `enabled.includes(detected)` always returns false for non-English speech
 * and the pipeline silently falls back to defaultLanguage — so the user's
 * Hindi gets transcribed but the agent replies in English with an English
 * voice. This function bridges the gap.
 *
 * Match strategy:
 *   1. Exact case-insensitive match (handles when Deepgram returns full
 *      BCP-47 like `'pt-BR'` or `'es-419'`).
 *   2. Reverse-lookup via the LANGUAGES catalog: every enabled language
 *      has its own `deepgram` code (`hi-IN` → `hi`). If `detected` matches
 *      any enabled language's deepgram code, that's our hit.
 *   3. Last resort: language-stem match (`'hi'` → first enabled `'hi-*'`).
 *
 * Returns the matched BCP-47 code or null if no enabled language fits.
 */
export function resolveDetectedLanguage(
  detected: string | undefined | null,
  enabled: readonly string[],
): string | null {
  if (!detected) return null;
  const norm = detected.toLowerCase();

  // 1) Exact match (case-insensitive) on the BCP-47 code itself.
  const exact = enabled.find((l) => l.toLowerCase() === norm);
  if (exact) return exact;

  // 2) Match via the LANGUAGES catalog's `deepgram` field — that's the
  //    authoritative mapping from BCP-47 → Deepgram code, and reversing it
  //    gives us the canonical answer. (`hi` → `hi-IN`, `pt` → `pt-PT`, etc.)
  const viaCatalog = enabled.find(
    (l) => byCode.get(l)?.deepgram?.toLowerCase() === norm,
  );
  if (viaCatalog) return viaCatalog;

  // 3) Stem match — handles cases where Deepgram returns a code we didn't
  //    catalog (e.g., a regional variant). Picks the first enabled language
  //    sharing the language stem.
  const detStem = norm.split('-')[0];
  const stemMatch = enabled.find((l) => l.toLowerCase().split('-')[0] === detStem);
  return stemMatch ?? null;
}
