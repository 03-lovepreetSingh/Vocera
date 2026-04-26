import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
const key = process.env.GOOGLE_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(key);
const candidates = ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite-preview'];
for (const m of candidates) {
  try {
    const model = genAI.getGenerativeModel({ model: m, systemInstruction: 'You are Vox, a friendly voice agent. Reply in 1 sentence.', generationConfig: { temperature: 0.7, maxOutputTokens: 128 } });
    const chat = model.startChat({ history: [] });
    const t0 = Date.now();
    const result = await chat.sendMessageStream([{ text: 'Hi, what services do you provide?' }]);
    let text = '', chunks = 0;
    for await (const c of result.stream) { const d = c.text(); if (d) { text += d; chunks++; } }
    console.log(`${m}: ✓ ${chunks} chunks ${Date.now()-t0}ms — "${text.slice(0,140)}"`);
  } catch (err) { console.log(`${m}: ✗ ${String(err).slice(0,180)}`); }
}
