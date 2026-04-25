// /api/transcribe — принимает audio (multipart/form-data: file=<blob>) и
// возвращает { text } через OpenAI Whisper.
// Используется в шаге «Тезисы» отчёта и потенциально в любом другом месте веба.

const Busboy = require('busboy');

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
    let fileBuffer = null;
    let fileName = 'audio.webm';
    let fileType = 'audio/webm';
    let language = 'ru';
    bb.on('file', (_name, file, info) => {
      fileName = info.filename || fileName;
      fileType = info.mimeType || info.mimetype || fileType;
      const chunks = [];
      file.on('data', (c) => chunks.push(c));
      file.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });
    bb.on('field', (name, val) => {
      if (name === 'language' && val) language = String(val).slice(0, 5);
    });
    bb.on('finish', () => resolve({ fileBuffer, fileName, fileType, language }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: 'OPENAI_API_KEY not set' });

  try {
    const { fileBuffer, fileName, fileType, language } = await readMultipart(req);
    if (!fileBuffer || !fileBuffer.length) return res.status(400).json({ error: 'empty file' });

    // Build multipart for OpenAI using FormData (Node 18+)
    const fd = new FormData();
    const blob = new Blob([fileBuffer], { type: fileType || 'audio/webm' });
    fd.append('file', blob, fileName);
    fd.append('model', 'whisper-1');
    fd.append('language', language || 'ru');
    fd.append('response_format', 'json');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: fd
    });
    if (!r.ok) {
      const txt = await r.text();
      return res.status(r.status).json({ error: `Whisper ${r.status}: ${txt.slice(0, 240)}` });
    }
    const d = await r.json();
    return res.status(200).json({ text: d.text || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};

module.exports.config = {
  api: { bodyParser: false }
};
