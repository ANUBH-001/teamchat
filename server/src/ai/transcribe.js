// Voice note -> text (Round 4). Gemini generateContent with the audio as inlineData; transcript in Hinglish Roman script.
// transcribe(mediaUrl) -> {text} | {error: off|no_file|too_large|type|api|empty} (a reason code, never a message with secrets). Only AI_PROVIDER=gemini with AI_API_KEY (+ aiEnabled) transcribes; anything else
// (other provider, no key, AI off, too large, any failure) -> {error} quietly (the caller marks transcriptStatus 'failed').
// The key / audio are never logged.
const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const provider = require('./provider');

const MIME = { m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mp3', ogg: 'audio/ogg', webm: 'audio/webm' };
const MAX_BYTES = 14 * 1024 * 1024; // inline request limit is ~20 MB incl. base64
const TIMEOUT_MS = 60000;
const PROMPT = 'Transcribe this voice note exactly as spoken, in Hinglish Roman script: write Hindi words in Latin letters ' +
  '(e.g. "Anubhav ka task 22 Uzair ko reassign karo") and English words as normal English. Keep names, numbers and the words ' +
  '"slash task", "slash done" as spoken. Output ONLY the transcript text, nothing else (no quotes, no notes). ' +
  'If there is no speech, output an empty string.';

// Spoken command words -> real slash command: "slash task Anubhav ko ..." -> "/task Anubhav ko ..."
function normalizeSpoken(t) {
  let s = String(t || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(?:forward\s+)?slash\s*[:,.-]?\s*([a-z]+)/i, (m, c) => '/' + c.toLowerCase());
  s = s.replace(/^\/\s+/, '/');
  return s;
}

async function transcribe(mediaUrl) {
  try {
    await settings.all();
    if (provider.providerName() !== 'gemini' || !provider.active()) return { error: 'off' };
    const file = require('../routes/media').resolvePath(mediaUrl);
    if (!file || !fs.existsSync(file)) return { error: 'no_file' };
    if (fs.statSync(file).size > MAX_BYTES) return { error: 'too_large' };
    const mime = MIME[path.extname(file).slice(1).toLowerCase()];
    if (!mime) return { error: 'type' };
    const data = fs.readFileSync(file).toString('base64');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(provider.modelName()) + ':generateContent';
    const res = await provider.post(url, { 'x-goog-api-key': process.env.AI_API_KEY }, {
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: mime, data } }] }],
      generationConfig: { temperature: 0 },
    }, TIMEOUT_MS);
    const parts = res && res.candidates && res.candidates[0] && res.candidates[0].content && res.candidates[0].content.parts;
    const text = parts ? parts.map((x) => x.text || '').join('').trim() : '';
    return text ? { text: normalizeSpoken(text).slice(0, 4000) } : { error: 'empty' };
  } catch (e) {
    console.error('transcribe failed:', e && e.code ? e.code : 'error');
    return { error: 'api' };
  }
}

module.exports = { transcribe, normalizeSpoken };
