const path = require('path');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const fs = require('fs');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Debug: log what env vars were loaded
if (dotenvResult.parsed) {
  console.log('[DEBUG] Loaded env vars:', Object.keys(dotenvResult.parsed).join(', '));
}

const URI = process.env.REACT_APP_MONGODB_URI || process.env.MONGODB_URI || process.env.REACT_APP_MONGO_URI || process.env.mongodb_uri;
const DB = 'chatapp';

let db;

async function connect() {
  if (!URI) {
    throw new Error('MongoDB URI is not defined. Please set REACT_APP_MONGODB_URI, MONGODB_URI, REACT_APP_MONGO_URI, or mongodb_uri in your .env file.');
  }
  const client = await MongoClient.connect(URI);
  db = client.db(DB);
  console.log('MongoDB connected');
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:2rem;background:#00356b;color:white;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0">
        <div style="text-align:center">
          <h1>Chat API Server</h1>
          <p>Backend is running. Use the React app at <a href="http://localhost:3000" style="color:#ffd700">localhost:3000</a></p>
          <p><a href="/api/status" style="color:#ffd700">Check DB status</a></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/api/status', async (req, res) => {
  try {
    const usersCount = await db.collection('users').countDocuments();
    const sessionsCount = await db.collection('sessions').countDocuments();
    res.json({ usersCount, sessionsCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ────────────────────────────────────────────────────────────────────

app.post('/api/users', async (req, res) => {
  try {
    const { username, password, email, firstName, lastName } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = String(username).trim().toLowerCase();
    const existing = await db.collection('users').findOne({ username: name });
    if (existing) return res.status(400).json({ error: 'Username already exists' });
    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      username: name,
      password: hashed,
      email: email ? String(email).trim().toLowerCase() : null,
      firstName: firstName ? String(firstName).trim() : '',
      lastName: lastName ? String(lastName).trim() : '',
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });
    const name = username.trim().toLowerCase();
    const user = await db.collection('users').findOne({ username: name });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({ ok: true, username: name, firstName: user.firstName || '', lastName: user.lastName || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'username required' });
    const sessions = await db
      .collection('sessions')
      .find({ username })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(
      sessions.map((s) => ({
        id: s._id.toString(),
        agent: s.agent || null,
        title: s.title || null,
        createdAt: s.createdAt,
        messageCount: (s.messages || []).length,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { username, agent } = req.body;
    if (!username) return res.status(400).json({ error: 'username required' });
    const { title } = req.body;
    const result = await db.collection('sessions').insertOne({
      username,
      agent: agent || null,
      title: title || null,
      createdAt: new Date().toISOString(),
      messages: [],
    });
    res.json({ id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await db.collection('sessions').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/sessions/:id/title', async (req, res) => {
  try {
    const { title } = req.body;
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { title } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Messages ─────────────────────────────────────────────────────────────────

app.post('/api/messages', async (req, res) => {
  try {
    const { session_id, role, content, imageData, charts, toolCalls } = req.body;
    if (!session_id || !role || content === undefined)
      return res.status(400).json({ error: 'session_id, role, content required' });
    const msg = {
      role,
      content,
      timestamp: new Date().toISOString(),
      ...(imageData && {
        imageData: Array.isArray(imageData) ? imageData : [imageData],
      }),
      ...(charts?.length && { charts }),
      ...(toolCalls?.length && { toolCalls }),
    };
    await db.collection('sessions').updateOne(
      { _id: new ObjectId(session_id) },
      { $push: { messages: msg } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const doc = await db
      .collection('sessions')
      .findOne({ _id: new ObjectId(session_id) });
    const raw = doc?.messages || [];
    const msgs = raw.map((m, i) => {
      const arr = m.imageData
        ? Array.isArray(m.imageData)
          ? m.imageData
          : [m.imageData]
        : [];
      return {
        id: `${doc._id}-${i}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        images: arr.length
          ? arr.map((img) => ({ data: img.data, mimeType: img.mimeType }))
          : undefined,
        charts: m.charts?.length ? m.charts : undefined,
        toolCalls: m.toolCalls?.length ? m.toolCalls : undefined,
      };
    });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// ── Save JSON to public folder ────────────────────────────────────────────────
app.post('/api/save-json', async (req, res) => {
  try {
    const { filename, data } = req.body;
    if (!filename || !data) return res.status(400).json({ error: 'filename and data required' });
    // Sanitize filename
    const safe = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const filePath = path.join(__dirname, '..', 'public', safe);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ ok: true, path: '/' + safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate image (placeholder - returns SVG with prompt text) ──────────────────
// TODO: Connect to a real image generation API (Replicate, Stability AI, DALL-E, etc.)
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, style } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const fullPrompt = style ? `${prompt}, ${style} style` : prompt;
    
    console.log('[Image Generation] Generating image for prompt:', fullPrompt);
    
    // Use Hugging Face Stable Diffusion API (free tier, no auth required for basic use)
    // Model: runwayml/stable-diffusion-v1-5 or stabilityai/stable-diffusion-2-1
    const model = 'runwayml/stable-diffusion-v1-5';
    const apiUrl = `https://api-inference.huggingface.co/models/${model}`;
    
    // Optional: Add Hugging Face token if you have one (for higher rate limits)
    const hfToken = process.env.HUGGINGFACE_API_TOKEN || '';
    const headers = {
      'Content-Type': 'application/json',
    };
    if (hfToken) {
      headers['Authorization'] = `Bearer ${hfToken}`;
    }
    
    console.log('[Image Generation] Calling Hugging Face API...');
    
    // Add timeout to prevent hanging (60 seconds for image generation)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    
    try {
      const hfResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          inputs: fullPrompt,
          parameters: {
            num_inference_steps: 30,
            guidance_scale: 7.5,
          },
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        console.error('[Image Generation] Hugging Face API error:', hfResponse.status, errorText);
        
        // If model is loading (503), wait a bit and retry once
        if (hfResponse.status === 503) {
          console.log('[Image Generation] Model loading, waiting 5 seconds and retrying...');
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          const retryResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              inputs: fullPrompt,
              parameters: {
                num_inference_steps: 30,
                guidance_scale: 7.5,
              },
            }),
            signal: controller.signal,
          });
          
          if (!retryResponse.ok) {
            const retryErrorText = await retryResponse.text();
            console.error('[Image Generation] Retry failed:', retryResponse.status, retryErrorText);
            return res.status(503).json({ 
              error: 'Image generation service is temporarily unavailable. Please try again in a moment.',
              fallback: true 
            });
          }
          
          // Use retry response
          const imageBuffer = await retryResponse.arrayBuffer();
          const imageBase64 = Buffer.from(imageBuffer).toString('base64');
          
          console.log('[Image Generation] Image generated successfully on retry, size:', imageBuffer.byteLength);
          
          return res.json({
            success: true,
            imageData: imageBase64,
            mimeType: 'image/png',
          });
        }
        
        // Rate limited
        if (hfResponse.status === 429) {
          return res.status(429).json({ 
            error: 'Rate limit exceeded. Please try again in a moment.',
            fallback: true 
          });
        }
        
        throw new Error(`Image generation API error: ${hfResponse.status} - ${errorText}`);
      }
      
      // Check if response is actually an image
      const contentType = hfResponse.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        const responseText = await hfResponse.text();
        console.error('[Image Generation] Unexpected response type:', contentType, responseText.substring(0, 200));
        throw new Error('API returned non-image response');
      }
      
      // Hugging Face returns the image as a blob
      const imageBuffer = await hfResponse.arrayBuffer();
      
      if (imageBuffer.byteLength === 0) {
        throw new Error('Received empty image from API');
      }
      
      const imageBase64 = Buffer.from(imageBuffer).toString('base64');
      
      console.log('[Image Generation] Image generated successfully, size:', imageBuffer.byteLength);
      
      res.json({
        success: true,
        imageData: imageBase64,
        mimeType: contentType || 'image/png',
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      
      if (fetchErr.name === 'AbortError') {
        console.error('[Image Generation] Request timeout after 60 seconds');
        return res.status(504).json({ 
          error: 'Image generation timed out. The service may be busy. Please try again.',
          fallback: true 
        });
      }
      
      throw fetchErr;
    }
  } catch (err) {
    console.error('[Image Generation] Error:', err.message, err.stack);
    
    // Return error to frontend instead of silently falling back
    // Frontend can decide to show placeholder or error message
    res.status(500).json({ 
      error: err.message || 'Failed to generate image',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      fallback: true 
    });
  }
});

// Helper function to generate placeholder SVG
function generatePlaceholderImage(prompt, res) {
  const escapedPrompt = String(prompt).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = escapedPrompt.match(/.{1,35}/g) || [escapedPrompt];
  
  let textElements = '';
  const startY = 200;
  const lineHeight = 30;
  lines.forEach((line, i) => {
    const y = startY + (i * lineHeight);
    textElements += `<text x="256" y="${y}" font-family="Arial, sans-serif" font-size="18" fill="#ffffff" text-anchor="middle">${line}</text>`;
  });
  
  const svg = `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#grad)"/>
    <text x="256" y="150" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">🎨 Generated Image</text>
    ${textElements}
    <text x="256" y="450" font-family="Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.7)" text-anchor="middle">Image generation placeholder</text>
  </svg>`;
  
  const svgBase64 = Buffer.from(svg).toString('base64');
  
  res.json({
    success: true,
    imageData: svgBase64,
    mimeType: 'image/svg+xml',
  });
}

const PORT = process.env.PORT || 3001;

connect()
  .then(() => {
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
