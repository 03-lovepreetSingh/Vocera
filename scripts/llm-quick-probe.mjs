import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const key = process.env.GOOGLE_GEMINI_API_KEY;
if (!key) { console.error('no key'); process.exit(1); }

const candidates = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest'];

for (const modelName of candidates) {
  process.stdout.write(`\n=== ${modelName} ===\n`);
  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: "You are Vox, a friendly voice agent. Be conversational. Use 1-2 sentences.",
      generationConfig: { temperature: 0.7, maxOutputTokens: 256 },
    });
    const chat = model.startChat({ history: [] });
    const t0 = Date.now();
    const result = await chat.sendMessageStream([{ text: "Hello, what services do you provide?" }]);
    let text = '';
    let chunks = 0;
    for await (const chunk of result.stream) {
      const d = chunk.text();
      if (d) { text += d; chunks++; }
    }
    const final = await result.response;
    process.stdout.write(`✓ ${chunks} chunks, ${Date.now()-t0}ms — "${text.slice(0,140)}${text.length>140?'…':''}"\n`);
    if (text.length === 0) {
      console.log('  finishReason:', final.candidates?.[0]?.finishReason);
      console.log('  blockReason :', final.promptFeedback?.blockReason);
    }
  } catch (err) {
    process.stdout.write(`✗ ${err.message?.slice(0,200)}\n`);
  }
}
