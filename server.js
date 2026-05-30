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
function buildComicSceneContext(comicOptions = {}) {
  const style = comicOptions.comic_style || 'manga';
  const angle = comicOptions.camera_angle || 'medium';
  const narrator = String(comicOptions.narrator || '').trim();

  const lines = [
    'IMPORTANT: Generate ONE comic/manga panel illustration. NOT a photorealistic photograph. NOT 3D render.',
    COMIC_STYLE_PROMPTS[style] || COMIC_STYLE_PROMPTS.manga
  ];

  if (CAMERA_ANGLE_PROMPTS[angle]) {
    lines.push(CAMERA_ANGLE_PROMPTS[angle]);
  }

  lines.push('Include clear panel borders or comic framing. Speech bubbles or caption boxes if dialogue/narration exists.');

  if (narrator) {
    lines.push(`Narration caption box text (in Indonesian): "${narrator}". Show as manga/comic narration box (not plain subtitle).`);
  }

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

/**
 * Expand a brief scene idea into a detailed comic panel prompt (text model).
 */
async function enhanceScenePrompt(briefPrompt, references, characterProperties, preferredModel, comicOptions = {}) {
  const refLines = references.length
    ? references.map(r => `- ${r.name} (${r.type})`).join('\n')
    : '(tidak ada referensi dipilih)';

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

  const style = comicOptions.comic_style || 'manga';
  const angle = comicOptions.camera_angle || 'medium';
  const narrator = String(comicOptions.narrator || '').trim();
  const styleLabel = { manga: 'manga Jepang', comic: 'comic book Amerika', manhwa: 'manhwa Korea', webtoon: 'webtoon' }[style] || 'manga';
  const angleLabel = {
    auto: 'sesuai adegan',
    close_up: 'close-up',
    medium: 'medium shot',
    wide: 'wide shot',
    birds_eye: 'bird\'s eye',
    worms_eye: 'worm\'s eye',
    over_shoulder: 'over-the-shoulder',
    dutch: 'dutch angle',
    profile: 'profil/samping'
  }[angle] || 'medium shot';

  const instruction = `Kamu adalah penulis prompt untuk AI yang menggambar PANEL KOMIK/MANGA (bukan foto realistis).
Perluas ide adegan singkat menjadi prompt detail untuk satu panel komik.
WAJIB sertakan: gaya ilustrasi ${styleLabel}, sudut pandang ${angleLabel}, line art komik, cel shading/warna flat komik, komposisi panel, latar, pencahayaan dramatis komik, aksi & ekspresi karakter.
Jangan deskripsikan sebagai fotografi atau render 3D. Gunakan nama referensi.
${narrator ? 'Sertakan kotak narasi/caption komik untuk teks narator yang diberikan.' : ''}
Tulis prompt final dalam Bahasa Indonesia (istilah visual boleh Inggris). Maksimal 140 kata.
Output HANYA teks prompt siap pakai untuk generate gambar, tanpa judul atau penjelasan.`;

  const userBlock = `Ide adegan singkat:
${briefPrompt}

Gaya komik: ${styleLabel}
Sudut pandang: ${angleLabel}
${narrator ? `Teks narator (caption box): ${narrator}` : 'Narator: (tidak ada)'}

Referensi yang dipakai:
${refLines}
${propLines ? `\nProperti karakter:\n${propLines}` : ''}`;

  const payload = {
    contents: [{
      parts: [{ text: `${instruction}\n\n${userBlock}` }]
    }],
    generationConfig: {
      temperature: 0.85,
      maxOutputTokens: 600
    }
  };

  const tryOrder = [...new Set([preferredModel, ...PROMPT_MODEL_FALLBACKS])];
  let lastError = null;

  for (const modelId of tryOrder) {
    try {
      console.log('Enhancing scene prompt with', modelId);
      const response = await callGeminiGenerateContent(modelId, payload);
      let text = extractGeminiText(response);
      text = text.replace(/^```[\w]*\n?|```$/g, '').trim();
      text = text.replace(/^["']|["']$/g, '').trim();
      return { text, modelUsed: modelId };
    } catch (err) {
      lastError = err;
      console.warn('Enhance failed on', modelId, err.message);
      if (!isModelUnavailableError(err.message)) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Semua model prompt gagal. Cek GEMINI_API_KEY dan pilihan model.');
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

  const comicContext = buildComicSceneContext(comicOptions);
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
