const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./comic-references.db');

const PORT = 8010;

// Load .env.local
function loadEnv(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      content.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
          const [key, ...valueParts] = line.split('=');
          const value = valueParts.join('=').trim();
          if (key && value) {
            process.env[key.trim()] = value;
          }
        }
      });
    }
  } catch (e) {
    console.warn('Warning: Could not load .env file:', e.message);
  }
}

loadEnv('./.env.local');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('WARNING: GEMINI_API_KEY not found in .env.local');
}

/** Katalog model — tier: free | limited | paid */
const GEMINI_MODEL_CATALOG = {
  prompt: [
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      tier: 'free',
      note: 'Default — rekomendasi perhalus prompt. Cepat, kuota gratis harian.'
    },
    {
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash Lite',
      tier: 'free',
      note: 'Versi lebih ringan 2.5, hemat kuota, cocok prompt singkat.'
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      tier: 'limited',
      note: 'Kualitas tertinggi 2.5, gratis terbatas; lebih lambat.'
    },
    {
      id: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      tier: 'free',
      note: 'Generasi 2.0, cepat, kuota gratis.'
    },
    {
      id: 'gemini-2.0-flash-lite',
      label: 'Gemini 2.0 Flash Lite',
      tier: 'free',
      note: 'Paling ringan, kuota gratis besar.'
    },
    {
      id: 'gemini-1.5-flash',
      label: 'Gemini 1.5 Flash',
      tier: 'free',
      note: 'Legacy stabil, masih gratis terbatas.'
    },
    {
      id: 'gemini-1.5-pro',
      label: 'Gemini 1.5 Pro',
      tier: 'limited',
      note: 'Legacy pro, gratis terbatas; untuk prompt kompleks.'
    }
  ],
  image: [
    {
      id: 'gemini-2.5-flash-image',
      label: 'Nano Banana (2.5 Flash Image)',
      tier: 'free',
      note: 'Default — generate gambar komik. Gratis terbatas per hari.'
    },
    {
      id: 'gemini-2.0-flash-preview-image-generation',
      label: 'Gemini 2.0 Flash Image (Preview)',
      tier: 'limited',
      note: 'Alternatif generate gambar, gratis terbatas; hasil bisa berbeda.'
    }
  ]
};

const DEFAULT_PROMPT_MODEL = process.env.GEMINI_PROMPT_MODEL || 'gemini-2.5-flash';
const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';

const PROMPT_MODEL_FALLBACKS = [...new Set([
  DEFAULT_PROMPT_MODEL,
  ...GEMINI_MODEL_CATALOG.prompt.map(m => m.id)
])];

function resolvePromptModel(requested) {
  const ids = GEMINI_MODEL_CATALOG.prompt.map(m => m.id);
  if (requested && ids.includes(requested)) return requested;
  return DEFAULT_PROMPT_MODEL;
}

function resolveImageModel(requested) {
  const ids = GEMINI_MODEL_CATALOG.image.map(m => m.id);
  if (requested && ids.includes(requested)) return requested;
  return DEFAULT_IMAGE_MODEL;
}

function isModelUnavailableError(message) {
  const m = String(message || '').toLowerCase();
  return m.includes('not found') || m.includes('no longer available') || m.includes('not supported');
}

const COMIC_STYLE_PROMPTS = {
  manga: 'Japanese manga style: clean ink lines, cel shading, screentone hints, expressive anime eyes, single manga panel composition',
  comic: 'American comic book style: bold outlines, dynamic shading, vibrant colors, halftone dots optional',
  manhwa: 'Korean manhwa style: soft gradients, detailed eyes, polished digital coloring, manhwa panel',
  webtoon: 'Webtoon style: full-color digital art, soft lighting, vertical panel friendly composition'
};

const CAMERA_ANGLE_PROMPTS = {
  auto: '',
  close_up: 'camera angle: extreme close-up on face, emotional detail',
  medium: 'camera angle: medium shot, waist-up framing',
  wide: 'camera angle: wide shot showing full body and environment',
  birds_eye: 'camera angle: bird\'s eye view from above',
  worms_eye: 'camera angle: worm\'s eye view from below, dramatic scale',
  over_shoulder: 'camera angle: over-the-shoulder shot',
  dutch: 'camera angle: dutch angle, tilted dramatic perspective',
  profile: 'camera angle: side profile shot'
};

/**
 * Build comic/manga-specific instructions appended to image prompts.
 */
function buildComicSceneContext(comicOptions = {}, scenePrompt = '') {
  const style = comicOptions.comic_style || 'manga';
  const angle = comicOptions.camera_angle || 'medium';

  const lines = [
    'IMPORTANT: Generate ONE comic/manga panel illustration. NOT a photorealistic photograph. NOT 3D render.',
    COMIC_STYLE_PROMPTS[style] || COMIC_STYLE_PROMPTS.manga
  ];

  if (CAMERA_ANGLE_PROMPTS[angle]) {
    lines.push(CAMERA_ANGLE_PROMPTS[angle]);
  }

  lines.push('Include clear panel borders or comic framing.');
  lines.push(buildSpeechInstructionBlock(analyzeSpeechInBrief(scenePrompt, comicOptions)));

  return lines.join('\n');
}

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Initialize database
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS comic_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('character', 'object', 'location')),
      image_base64 TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      image_base64 TEXT NOT NULL,
      reference_ids TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  console.log('Database initialized');
});

// Middleware: Parse JSON body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  console.log(`${req.method} ${req.url}`);

  try {
    // GET /api/config - Model catalog & defaults
    if (req.method === 'GET' && req.url === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: {
          models: GEMINI_MODEL_CATALOG,
          defaults: {
            prompt: DEFAULT_PROMPT_MODEL,
            image: DEFAULT_IMAGE_MODEL
          },
          hasApiKey: Boolean(GEMINI_API_KEY)
        }
      }));
      return;
    }

    // GET /api/references - List all references
    if (req.method === 'GET' && req.url === '/api/references') {
      db.all('SELECT id, name, type, image_base64, created_at FROM comic_references ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: rows }));
      });
      return;
    }

    // GET /api/references/:id/image - Get single reference image
    if (req.method === 'GET' && req.url.startsWith('/api/references/')) {
      const id = req.url.split('/')[3];
      db.get('SELECT * FROM comic_references WHERE id = ?', [id], (err, row) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        if (!row) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Reference not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: row }));
      });
      return;
    }

    // POST /api/references - Create new reference
    if (req.method === 'POST' && req.url === '/api/references') {
      const body = await parseBody(req);
      const { name, type, image_base64 } = body;

      if (!name || !type || !image_base64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: name, type, image_base64' }));
        return;
      }

      if (!['character', 'object', 'location'].includes(type)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid type. Must be: character, object, or location' }));
        return;
      }

      db.run(
        'INSERT INTO comic_references (name, type, image_base64) VALUES (?, ?, ?)',
        [name, type, image_base64],
        function(err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint')) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Reference with name "${name}" already exists` }));
            } else {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { id: this.lastID, name, type } }));
        }
      );
      return;
    }

    // DELETE /api/references/:id - Delete reference
    if (req.method === 'DELETE' && req.url.startsWith('/api/references/')) {
      const id = req.url.split('/')[3];
      db.run('DELETE FROM comic_references WHERE id = ?', [id], function(err) {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        if (this.changes === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Reference not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Reference deleted' }));
      });
      return;
    }

    // POST /api/generate - Generate comic image
    if (req.method === 'POST' && req.url === '/api/generate') {
      const body = await parseBody(req);
      const { prompt, reference_ids, image_model, comic_options } = body;

      if (!prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: prompt' }));
        return;
      }

      // Fetch reference images
      if (!reference_ids || !Array.isArray(reference_ids) || reference_ids.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'At least one reference_id is required' }));
        return;
      }

      // Create placeholder marks for IN clause
      const placeholders = reference_ids.map(() => '?').join(',');
      const query = `SELECT name, type, image_base64 FROM comic_references WHERE id IN (${placeholders})`;
      
      db.all(query, reference_ids, async (err, references) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }

          if (references.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No references found' }));
            return;
          }

          try {
            // Call Gemini Nano Banana API
            const geminiResult = await callGeminiAPI(
              prompt,
              references,
              resolveImageModel(image_model),
              comic_options || {}
            );
            
            // Save generation to database
            const refIdsJson = JSON.stringify(reference_ids);
            db.run(
              'INSERT INTO generations (prompt, image_base64, reference_ids) VALUES (?, ?, ?)',
              [prompt, geminiResult.image_base64, refIdsJson],
              function(saveErr) {
                if (saveErr) {
                  console.error('Failed to save generation:', saveErr);
                }
              }
            );
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              data: { 
                image_base64: geminiResult.image_base64,
                prompt: prompt,
                references_used: references.map(r => ({ name: r.name, type: r.type }))
              } 
            }));
          } catch (geminiError) {
            console.error('Gemini API error:', geminiError);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to generate image: ' + geminiError.message }));
          }
        }
      );
      return;
    }

    // POST /api/enhance-prompt - Expand scene prompt with Gemini text model
    if (req.method === 'POST' && req.url === '/api/enhance-prompt') {
      const body = await parseBody(req);
      const { prompt, reference_ids, character_properties, prompt_model, comic_options } = body;

      if (!prompt || !String(prompt).trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required field: prompt' }));
        return;
      }

      const ids = Array.isArray(reference_ids) ? reference_ids : [];

      const finishEnhance = async (references) => {
        try {
          const result = await enhanceScenePrompt(
            String(prompt).trim(),
            references,
            character_properties || {},
            resolvePromptModel(prompt_model),
            comic_options || {}
          );
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            data: {
              prompt: result.text,
              model_used: result.modelUsed
            }
          }));
        } catch (err) {
          console.error('Enhance prompt error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      };

      if (ids.length === 0) {
        await finishEnhance([]);
        return;
      }

      const placeholders = ids.map(() => '?').join(',');
      const query = `SELECT id, name, type FROM comic_references WHERE id IN (${placeholders})`;
      db.all(query, ids, async (err, references) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        await finishEnhance(references);
      });
      return;
    }

    // GET /api/generations - List all generations
    if (req.method === 'GET' && req.url === '/api/generations') {
      db.all('SELECT id, prompt, image_base64, reference_ids, created_at FROM generations ORDER BY created_at DESC', [], (err, rows) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: rows }));
      });
      return;
    }

    // DELETE /api/generations/:id - Delete generation
    if (req.method === 'DELETE' && req.url.startsWith('/api/generations/')) {
      const id = req.url.split('/')[3];
      db.run('DELETE FROM generations WHERE id = ?', [id], function(err) {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        if (this.changes === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Generation not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Generation deleted' }));
      });
      return;
    }

    // Serve static files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = filePath.split('?')[0];
    const fullPath = path.join(__dirname, filePath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      fs.readFile(fullPath, (err, content) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File read error' }));
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content);
        }
      });
      return;
    }

    // 404 Not Found
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 Not Found</h1>');

  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
  }
});

const ENHANCE_MAX_OUTPUT_TOKENS = 2048;
const ENHANCE_CONTINUATION_MAX_TOKENS = 1024;

function getGeminiFinishReason(response) {
  return String(response.candidates?.[0]?.finishReason || '').toUpperCase();
}

function extractGeminiText(response) {
  const candidates = response.candidates || [];
  if (candidates.length === 0) {
    throw new Error('No response from Gemini');
  }
  const parts = candidates[0].content?.parts || [];
  const textPart = parts.find(p => p.text);
  if (!textPart || !textPart.text) {
    throw new Error('No text response from Gemini');
  }
  return textPart.text.trim();
}

/** Respons enhance terpotong di tengah kalimat / token habis */
function isTruncatedEnhanceText(text, finishReason) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (finishReason === 'MAX_TOKENS') return true;
  if (t.length < 40) return false;
  if (/[.!?…"»]$/.test(t)) return false;
  if (/\b(speech bubble|thought bubble|kotak narasi|gelembung)/i.test(t) && !/[.!?]$/.test(t)) return true;
  const tail = t.slice(-80);
  if (/(bubble|narasi|dialog|monolog|berkata|caption)\s*[:「"']?\s*[^.!?]{0,120}$/i.test(tail)) return true;
  if (/,\s*$/.test(t) || /\s(dan|dengan|sambil|yang|di|ke|pada)\s*$/i.test(t)) return true;
  return false;
}

function getEnhanceWordRange(speech) {
  const hasTextInPanel = speech.hasDialogue || speech.hasMonologue || speech.narrator || speech.dialogueLines.length > 0;
  if (hasTextInPanel) {
    return '120–280 kata. Semua teks dialog, thought bubble, dan caption WAJIB utuh (jangan dipotong di tengah).';
  }
  return '100–200 kata.';
}

function callGeminiGenerateContent(model, payload) {
  if (!GEMINI_API_KEY) {
    return Promise.reject(new Error('GEMINI_API_KEY not configured'));
  }

  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const postData = JSON.stringify(payload);
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (res.statusCode >= 400 || response.error) {
            const msg = response.error?.message || `HTTP ${res.statusCode}`;
            reject(new Error(`Gemini API error: ${msg}`));
            return;
          }
          resolve(response);
        } catch (e) {
          reject(new Error('Failed to parse Gemini response: ' + e.message));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error('Gemini API request failed: ' + e.message));
    });

    req.write(postData);
    req.end();
  });
}

function getComicOptionLabels(comicOptions = {}) {
  const style = comicOptions.comic_style || 'manga';
  const angle = comicOptions.camera_angle || 'medium';
  const styleLabel = { manga: 'manga', comic: 'comic book', manhwa: 'manhwa', webtoon: 'webtoon' }[style] || 'manga';
  const anglePhrase = {
    auto: '',
    close_up: 'close-up pada wajah',
    medium: 'medium shot (bahu ke atas)',
    wide: 'wide shot (seluruh tubuh dan lingkungan)',
    birds_eye: 'sudut dari atas (bird\'s eye)',
    worms_eye: 'sudut dari bawah (worm\'s eye)',
    over_shoulder: 'over-the-shoulder',
    dutch: 'dutch angle miring dramatis',
    profile: 'profil dari samping'
  }[angle] || '';
  return {
    styleLabel,
    anglePhrase,
    narrator: String(comicOptions.narrator || '').trim(),
    dialogue: String(comicOptions.dialogue || '').trim(),
    speechMode: comicOptions.speech_mode || 'auto'
  };
}

/** Deteksi dialog, monolog, dll. dari teks adegan + pengaturan pengguna */
function analyzeSpeechInBrief(briefPrompt, comicOptions = {}) {
  const brief = String(briefPrompt || '').trim();
  const { dialogue, narrator, speechMode } = getComicOptionLabels(comicOptions);

  const quoted = [];
  const patterns = [
    /[“"]([^”"]+)[”"]/g,
    /'([^']+)'/g,
    /「([^」]+)」/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(brief)) !== null) {
      const line = (m[1] || '').trim();
      if (line.length > 0) quoted.push(line);
    }
  }

  const hasMonologueHint = /berbicara dengan diri sendiri|berbicara pada diri|monolog|bergumam|dalam hatinya|dalam pikirannya|berpikir keras|membatin|mengomong pada diri|berbicara sendiri|menggeram pada diri/i.test(brief);
  const hasDialogueHint = /bilang|berkata|teriak|bertanya|menjawab|berseru|berbicara kepada|berbicara ke|dialog|ucap|pesan\s*:/i.test(brief)
    || quoted.length > 0
    || dialogue.length > 0;

  let mode = speechMode;
  if (mode === 'auto') {
    if (hasMonologueHint && (hasDialogueHint || dialogue || quoted.length)) mode = 'both';
    else if (hasMonologueHint) mode = 'monologue';
    else if (hasDialogueHint || dialogue || quoted.length) mode = 'dialogue';
    else mode = 'none';
  }

  const dialogueLines = [...new Set([dialogue, ...quoted].filter(Boolean))];

  return {
    mode,
    dialogueLines,
    hasMonologue: mode === 'monologue' || mode === 'both' || hasMonologueHint,
    hasDialogue: mode === 'dialogue' || mode === 'both' || dialogueLines.length > 0,
    narrator
  };
}

function buildSpeechInstructionBlock(speech) {
  const lines = [];

  if (speech.narrator) {
    lines.push(`Kotak narasi (caption box persegi panjang, pihak ketiga): "${speech.narrator}"`);
  }

  if (speech.hasDialogue && speech.dialogueLines.length) {
    speech.dialogueLines.forEach((line, i) => {
      lines.push(`Gelembung dialog / speech bubble ${i + 1} (oval, ujung menunjuk mulut karakter): "${line}"`);
    });
  } else if (speech.hasDialogue) {
    lines.push('Ada dialog antar karakter: tampilkan speech bubble dengan teks dialog yang disebut di adegan (teks harus terbaca).');
  }

  if (speech.hasMonologue) {
    lines.push('Karakter berbicara dengan diri sendiri / monolog internal: gunakan thought bubble (gumpalan awan), BUKAN speech bubble biasa. Ekspresi introspektif.');
  }

  if (!speech.hasDialogue && !speech.hasMonologue && !speech.narrator) {
    lines.push('Tidak ada teks dialog/narasi di panel kecuali disebut eksplisit di adegan.');
  }

  return lines.join('\n');
}

/** Deteksi output AI yang hanya daftar pengaturan, bukan adegan */
function isWeakEnhanceOutput(text, briefPrompt) {
  const t = text.trim();
  const brief = briefPrompt.trim().toLowerCase();
  if (t.length < 50) return true;

  const briefTokens = brief.split(/\s+/).filter(w => w.length >= 4);
  const matched = briefTokens.filter(w => t.toLowerCase().includes(w.slice(0, Math.max(4, w.length - 1))));
  if (briefTokens.length >= 2 && matched.length === 0) return true;

  const settingsOnly = /^(panel\s+)?(manga|manhwa|webtoon|comic).{0,120}(gaya|line art|cel shading|medium shot|wide shot|close-up)/i.test(t)
    && t.length < 180
    && matched.length <= 1;
  if (settingsOnly) return true;

  const commaList = (t.match(/,/g) || []).length >= 3 && t.length < 120 && matched.length === 0;
  if (commaList) return true;

  return false;
}

function buildFallbackComicPrompt(briefPrompt, references, comicOptions) {
  const { styleLabel, anglePhrase } = getComicOptionLabels(comicOptions);
  const speech = analyzeSpeechInBrief(briefPrompt, comicOptions);
  const names = references.map(r => r.name).filter(Boolean);
  const angleBit = anglePhrase ? `, ${anglePhrase}` : '';
  const charBit = names.length ? ` Karakter: ${names.join(', ')}.` : '';
  const speechBit = buildSpeechInstructionBlock(speech);
  const speechSuffix = speechBit ? ` ${speechBit.replace(/\n/g, ' ')}` : '';
  return (
    `Panel ilustrasi ${styleLabel}${angleBit}, satu frame komik (bukan foto): ${briefPrompt.trim()}.` +
    `${charBit} Ekspresi dan pose jelas, latar detail, pencahayaan dramatis, line art tebal, cel shading, warna flat komik.` +
    speechSuffix
  );
}

function buildEnhancePromptPayload(briefPrompt, references, characterProperties, comicOptions, strictMode) {
  const refLines = references.length
    ? references.map(r => `- ${r.name} (${r.type})`).join('\n')
    : '(tidak ada)';

  const propLines = references
    .map(r => {
      const props = characterProperties[r.id] || characterProperties[String(r.id)];
      if (!props || !Object.keys(props).length) return null;
      const bits = [];
      if (props.pose) bits.push(`pose: ${props.pose}`);
      if (props.expression) bits.push(`ekspresi: ${props.expression}`);
      if (props.clothing) bits.push(`pakaian: ${props.clothing}`);
      if (props.notes) bits.push(`catatan: ${props.notes}`);
      return bits.length ? `- ${r.name}: ${bits.join(', ')}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const { styleLabel, anglePhrase } = getComicOptionLabels(comicOptions);
  const speech = analyzeSpeechInBrief(briefPrompt, comicOptions);
  const speechRules = `ATURAN TEKS DI PANEL:
- Dialog antar karakter → speech bubble (gelembung oval), sebut teks persis jika ada.
- Berbicara dengan diri sendiri / monolog → thought bubble (awan), jangan campur dengan dialog orang lain.
- Narasi pihak ketiga → kotak caption terpisah (bukan speech bubble).
${buildSpeechInstructionBlock(speech)}`;

  const instruction = strictMode
    ? `Tulis SATU paragraf deskripsi visual adegan komik dalam Bahasa Indonesia.
WAJIB ceritakan apa yang TERJADI di panel (aksi, emosi, latar, pose) berdasarkan ide pengguna.
LARANGAN: jangan hanya menulis "manga, gaya komik, medium shot" atau daftar pengaturan.
Contoh BENAR: "Panel manga, medium shot: Luna terpojok di lorong gua, speech bubble \"Aku tidak bisa kabur!\", thought bubble kecil \"Tenang... napas dulu.\", kotak narasi di atas: Malam itu gua terasa lebih sempit."
Sisipkan secara natural: gaya ${styleLabel}${anglePhrase ? ', ' + anglePhrase : ''}, bukan foto.
${speechRules}
${getEnhanceWordRange(speech)} Output HANYA paragraf prompt adegan, tanpa judul.`
    : `Kamu menulis prompt untuk AI menggambar SATU panel komik/manga (bukan foto).
Perluas ide pengguna menjadi paragraf naratif yang menggambarkan adegan lengkap: siapa, apa yang terjadi, emosi, pose, latar, cahaya.
Jangan output daftar label seperti "Manga Jepang, gaya komik, medium shot Luna" — itu SALAH.
Benar: cerita visual panel + sisipkan gaya ${styleLabel}${anglePhrase ? ' dan ' + anglePhrase : ''} di awal/akhir secara ringkas.
${speechRules}
Bahasa Indonesia. ${getEnhanceWordRange(speech)} Hanya teks prompt adegan.`;

  const userBlock = `IDE ADEGAN (wajib diperluas dan tetap jadi inti cerita):
"""
${briefPrompt.trim()}
"""

Karakter referensi (gunakan nama ini di adegan):
${refLines}
${propLines ? `\nDetail karakter:\n${propLines}` : ''}`;

  return {
    contents: [{ parts: [{ text: `${instruction}\n\n${userBlock}` }] }],
    generationConfig: {
      temperature: strictMode ? 0.65 : 0.8,
      maxOutputTokens: ENHANCE_MAX_OUTPUT_TOKENS
    }
  };
}

function buildEnhanceContinuationPayload(partialText, briefPrompt, comicOptions) {
  const speech = analyzeSpeechInBrief(briefPrompt, comicOptions);
  return {
    contents: [{
      parts: [{
        text: `Prompt adegan komik berikut TERPOTONG. Lanjutkan dari potongan terakhir tanpa mengulang awal.
Selesaikan kalimat yang putus dan lengkapi semua speech/thought/caption box yang belum selesai.
${getEnhanceWordRange(speech)}
Hanya keluarkan LANJUTAN teks (bukan ulang dari awal).

POTONGAN:
"""
${partialText.trim()}
"""`
      }]
    }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: ENHANCE_CONTINUATION_MAX_TOKENS
    }
  };
}

function mergeEnhancedParts(base, continuation) {
  const a = String(base || '').trim();
  const b = String(continuation || '').trim();
  if (!b) return a;
  if (b.startsWith(a)) return b;
  if (a.endsWith(b) || a.includes(b)) return a;
  const overlap = Math.min(a.length, b.length, 120);
  for (let len = overlap; len >= 12; len--) {
    const suffix = a.slice(-len);
    if (b.startsWith(suffix)) {
      return a + b.slice(len);
    }
  }
  const joiner = /[\s\-—,:]$/.test(a) ? '' : ' ';
  return a + joiner + b;
}

function cleanEnhancedText(text) {
  let t = text.replace(/^```[\w]*\n?|```$/g, '').trim();
  t = t.replace(/^["']|["']$/g, '').trim();
  t = t.replace(/^(prompt|adegan|hasil)\s*:\s*/i, '').trim();
  return t;
}

/**
 * Expand a brief scene idea into a detailed comic panel prompt (text model).
 */
async function enhanceScenePrompt(briefPrompt, references, characterProperties, preferredModel, comicOptions = {}) {
  const tryOrder = [...new Set([preferredModel, ...PROMPT_MODEL_FALLBACKS])];
  let lastError = null;

  for (const modelId of tryOrder) {
    for (const strictMode of [false, true]) {
      try {
        const payload = buildEnhancePromptPayload(
          briefPrompt,
          references,
          characterProperties,
          comicOptions,
          strictMode
        );
        console.log('Enhancing scene prompt with', modelId, strictMode ? '(strict)' : '');
        const response = await callGeminiGenerateContent(modelId, payload);
        const finishReason = getGeminiFinishReason(response);
        let text = cleanEnhancedText(extractGeminiText(response));

        if (isTruncatedEnhanceText(text, finishReason)) {
          console.warn('Enhance output truncated, requesting continuation');
          try {
            const contPayload = buildEnhanceContinuationPayload(text, briefPrompt, comicOptions);
            const contResponse = await callGeminiGenerateContent(modelId, contPayload);
            const contText = cleanEnhancedText(extractGeminiText(contResponse));
            text = cleanEnhancedText(mergeEnhancedParts(text, contText));
          } catch (contErr) {
            console.warn('Enhance continuation failed:', contErr.message);
          }
        }

        if (isWeakEnhanceOutput(text, briefPrompt)) {
          console.warn('Weak enhance output, retry or fallback');
          if (!strictMode) continue;
          text = buildFallbackComicPrompt(briefPrompt, references, comicOptions);
        }

        return { text, modelUsed: modelId };
      } catch (err) {
        lastError = err;
        console.warn('Enhance failed on', modelId, err.message);
        if (!isModelUnavailableError(err.message)) {
          throw err;
        }
        break;
      }
    }
  }

  const fallback = buildFallbackComicPrompt(briefPrompt, references, comicOptions);
  return { text: fallback, modelUsed: 'fallback' };
}

/**
 * Call Gemini Flash Image API (Nano Banana) for image generation
 * @param {string} prompt - Text description of the scene
 * @param {Array} references - Array of { name, type, image_base64 }
 * @returns {Promise<{image_base64: string}>}
 */
async function callGeminiAPI(prompt, references, imageModel, comicOptions = {}) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('Calling Gemini Flash Image API (Nano Banana) with:', {
    prompt,
    reference_count: references.length
  });

  // Build request payload for Gemini Flash Image
  const parts = [];

  // Add reference images first (for character/object consistency)
  for (const ref of references) {
    // Remove data:image/xxx;base64, prefix if present
    const base64Data = ref.image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
    
    parts.push({
      text: `Reference image - ${ref.name} (${ref.type}):`
    });
    
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: base64Data
      }
    });
  }

  const comicContext = buildComicSceneContext(comicOptions, prompt);
  parts.push({
    text: `${comicContext}\n\nScene to illustrate:\n${prompt}`
  });

  const payload = {
    contents: [{
      parts: parts
    }]
  };

  const modelId = imageModel || DEFAULT_IMAGE_MODEL;
  console.log('Using image model:', modelId);
  const response = await callGeminiGenerateContent(modelId, payload);
  const candidates = response.candidates || [];
  if (candidates.length === 0) {
    throw new Error('No response from Gemini');
  }
  const contentParts = candidates[0].content?.parts || [];
  const imagePart = contentParts.find(p => p.inlineData || p.inline_data);
  if (imagePart) {
    const imageData = imagePart.inlineData || imagePart.inline_data;
    const mimeType = imageData.mimeType || 'image/png';
    const base64Image = `data:${mimeType};base64,${imageData.data}`;
    return { image_base64: base64Image };
  }
  const textPart = contentParts.find(p => p.text);
  if (textPart) {
    throw new Error('Model returned text instead of image. Periksa ketersediaan gemini-2.5-flash-image pada API key Anda.');
  }
  throw new Error('No image response from Gemini');
}

server.listen(PORT, () => {
  console.log(`Comic Generator running at http://localhost:${PORT}`);
  console.log('Database: ./comic-references.db');
  console.log('Frontend & Backend in one server');
});
