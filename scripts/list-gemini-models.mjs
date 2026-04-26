import 'dotenv/config';
const key = process.env.GOOGLE_GEMINI_API_KEY;
if (!key) { console.error('no key'); process.exit(1); }
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
const j = await res.json();
if (!j.models) { console.log('error', JSON.stringify(j).slice(0,500)); process.exit(1); }
const usable = j.models.filter(m => m.supportedGenerationMethods?.includes('generateContent'));
for (const m of usable) {
  console.log(m.name.replace('models/',''), '|', m.displayName);
}
