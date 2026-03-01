import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { streamChat, chatWithCsvTools, chatWithYoutubeTools, CODE_KEYWORDS } from '../services/gemini';
import { executeYoutubeTool } from '../services/csvTools';
import { parseCsvToRows, executeTool, computeDatasetSummary, enrichWithEngagement, buildSlimCsv } from '../services/csvTools';
import {
  getSessions,
  createSession,
  deleteSession,
  saveMessage,
  loadMessages,
} from '../services/mongoApi';
import EngagementChart from './EngagementChart';
import YouTubeDownload from './YouTubeDownload';
import './Chat.css';
import React from 'react';

// ── YouTube tool render components ───────────────────────────────────────────
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';

function fmtNum(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}

function MetricChart({ chart }) {
  const [enlarged, setEnlarged] = React.useState(false);
  const data = chart.data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    value: d.value,
    title: d.title,
  }));
  const ChartEl = ({ h = 200 }) => (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
        <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} />
        <YAxis tickFormatter={fmtNum} tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} width={48} />
        <RechartsTooltip
          contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0', fontSize: 11 }}
          formatter={(v) => [fmtNum(v), chart.metric.replace(/_/g,' ')]}
        />
        <Line type="monotone" dataKey="value" stroke={chart.color || '#a855f7'} strokeWidth={2} dot={{ r: 2, fill: chart.color || '#a855f7' }} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
  return (
    <>
      <div className="yt-chart-wrap" onClick={() => setEnlarged(true)} title="Click to enlarge">
        <p className="yt-chart-title">{chart.title}</p>
        <ChartEl />
        <p className="yt-chart-hint">Click to enlarge</p>
      </div>
      {enlarged && (
        <div className="yt-chart-overlay" onClick={() => setEnlarged(false)}>
          <div className="yt-chart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="yt-chart-modal-header">
              <span>{chart.title}</span>
              <button
                className="yt-chart-download"
                onClick={() => {
                  // Download as SVG/PNG via canvas would require html2canvas; offer data download instead
                  const csv = 'date,value,title\n' + chart.data.map((d) => `${d.date},${d.value},"${d.title}"`).join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                  a.download = `${chart.metric}_chart_data.csv`; a.click();
                }}
              >⬇ Download Data</button>
              <button onClick={() => setEnlarged(false)} className="yt-chart-close">✕</button>
            </div>
            <ChartEl h={400} />
          </div>
        </div>
      )}
    </>
  );
}

function VideoCard({ chart }) {
  return (
    <a href={chart.video_url} target="_blank" rel="noreferrer" className="yt-video-card">
      <div className="yt-video-thumb-wrap">
        <img
          src={chart.thumbnail_url || `https://img.youtube.com/vi/${chart.video_id}/mqdefault.jpg`}
          alt={chart.title}
          className="yt-video-thumb"
        />
        <div className="yt-video-play"><svg viewBox="0 0 24 24" fill="white" width="20" height="20"><path d="M8 5v14l11-7z"/></svg></div>
      </div>
      <div className="yt-video-info">
        <p className="yt-video-title">{chart.title}</p>
        {chart.description && <p className="yt-video-desc">{chart.description}</p>}
        <p className="yt-video-link">▶ Watch on YouTube</p>
      </div>
    </a>
  );
}

function StatsCard({ chart }) {
  const s = chart.stats;
  if (!s) return null;
  const items = [
    { label: 'Mean', v: fmtNum(s.mean) },
    { label: 'Median', v: fmtNum(s.median) },
    { label: 'Std Dev', v: fmtNum(s.std) },
    { label: 'Min', v: fmtNum(s.min) },
    { label: 'Max', v: fmtNum(s.max) },
    { label: 'Count', v: s.count },
  ];
  return (
    <div className="yt-stats-card">
      <p className="yt-stats-label">{chart.label} statistics</p>
      <div className="yt-stats-grid">
        {items.map((item) => (
          <div key={item.label} className="yt-stats-item">
            <span className="yt-stats-item-label">{item.label}</span>
            <span className="yt-stats-item-val">{item.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenerateImageCard({ chart }) {
  const [imageData, setImageData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    const generateImage = async () => {
      try {
        setLoading(true);
        setError(null);
        console.log('[GenerateImage] Starting generation for prompt:', chart.prompt);
        
        // Use REACT_APP_API_URL in production, or relative path in development
        const apiUrl = process.env.REACT_APP_API_URL || '';
        const url = `${apiUrl}/api/generate-image`;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: chart.prompt,
            style: chart.style || 'realistic',
          }),
        });

        // Get response as text first to handle potential parsing issues
        const responseText = await response.text();
        console.log('[GenerateImage] Response status:', response.status, 'Length:', responseText.length);
        
        if (!responseText || responseText.trim() === '') {
          console.error('[GenerateImage] Empty response');
          setError('Empty response from server');
          return;
        }

        let data;
        try {
          data = JSON.parse(responseText);
        } catch (parseError) {
          console.error('[GenerateImage] JSON parse error:', parseError);
          console.error('[GenerateImage] Response text:', responseText.substring(0, 200));
          setError(`Failed to parse response: ${parseError.message}`);
          return;
        }
        
        console.log('[GenerateImage] Response:', { success: data.success, hasImageData: !!data.imageData, error: data.error, fallback: data.fallback });
        
        // If API returned an error with fallback flag, show placeholder
        if (!response.ok || data.error) {
          if (data.fallback) {
            console.log('[GenerateImage] API error with fallback flag, showing placeholder');
            // Generate placeholder SVG client-side
            const placeholderSvg = generatePlaceholderSVG(chart.prompt);
            setImageData({ data: placeholderSvg, mimeType: 'image/svg+xml' });
            setError(`⚠️ ${data.error || 'Image generation unavailable'}. Showing placeholder.`);
          } else {
            setError(data.error || `API error: ${response.status}`);
          }
          return;
        }
        
        if (data.success && data.imageData) {
          setImageData({ data: data.imageData, mimeType: data.mimeType });
          console.log('[GenerateImage] Image data set successfully');
        } else {
          console.error('[GenerateImage] No image data in response:', data);
          setError(data.error || 'Failed to generate image');
        }
      } catch (err) {
        console.error('[GenerateImage] Exception:', err);
        setError(err.message || 'Failed to generate image');
      } finally {
        setLoading(false);
      }
    };

    if (chart.prompt) {
      generateImage();
    }
  }, [chart.prompt, chart.style]);

  const handleDownload = () => {
    if (!imageData) return;
    const blob = new Blob([Uint8Array.from(atob(imageData.data), c => c.charCodeAt(0))], { type: imageData.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generated-image-${Date.now()}.${imageData.mimeType === 'image/svg+xml' ? 'svg' : 'png'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Helper to generate placeholder SVG
  const generatePlaceholderSVG = (prompt) => {
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
    return btoa(unescape(encodeURIComponent(svg)));
  };

  return (
    <div className="yt-genimage-card">
      <p className="yt-genimage-label">🎨 Generated Image</p>
      <p className="yt-genimage-prompt">Prompt: <em>{chart.prompt}</em></p>

      {loading && <p className="yt-genimage-note">Generating image... (this may take 10-30 seconds)</p>}
      {error && <p className="yt-genimage-error">{error}</p>}

      {imageData && (
        <>
          <div className="yt-genimage-preview" onClick={() => setEnlarged(true)}>
            <img
              src={`data:${imageData.mimeType};base64,${imageData.data}`}
              alt={chart.prompt}
              style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer' }}
            />
          </div>
          <div className="yt-genimage-actions">
            <button onClick={handleDownload} className="yt-genimage-download">💾 Download</button>
            <button onClick={() => setEnlarged(true)} className="yt-genimage-enlarge">🔍 Enlarge</button>
          </div>
        </>
      )}

      {enlarged && imageData && (
        <div className="yt-chart-overlay" onClick={() => setEnlarged(false)}>
          <div className="yt-chart-modal" onClick={(e) => e.stopPropagation()}>
            <div className="yt-chart-modal-header">
              <span>Generated Image</span>
              <button onClick={() => setEnlarged(false)} className="yt-chart-close">✕</button>
            </div>
            <img
              src={`data:${imageData.mimeType};base64,${imageData.data}`}
              alt={chart.prompt}
              style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: '8px' }}
            />
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <button onClick={handleDownload} className="yt-genimage-download">💾 Download Image</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function YoutubeToolOutput({ chart }) {
  if (chart._toolType === 'chart') return <MetricChart chart={chart} />;
  if (chart._toolType === 'videoCard') return <VideoCard chart={chart} />;
  if (chart._toolType === 'stats') return <StatsCard chart={chart} />;
  if (chart._toolType === 'generateImage') return <GenerateImageCard chart={chart} />;
  return null;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

const chatTitle = () => {
  const d = new Date();
  return `Chat · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// Encode a string to base64 safely (handles unicode/emoji in tweet text etc.)
const toBase64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const parseCSV = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rowCount = lines.length - 1;

  // Short human-readable preview (header + first 5 rows) for context
  const preview = lines.slice(0, 6).join('\n');

  // Full CSV as base64 — avoids ALL string-escaping issues in Python code execution
  // (tweet text with quotes, apostrophes, emojis, etc. all break triple-quoted strings)
  const raw = text.length > 500000 ? text.slice(0, 500000) : text;
  const base64 = toBase64(raw);
  const truncated = text.length > 500000;

  return { headers, rowCount, preview, base64, truncated };
};

// Extract plain text from a message (for history only — never returns base64)
const messageText = (m) => {
  if (m.parts) return m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return m.content || '';
};

// ── Structured part renderer (code execution responses) ───────────────────────

function StructuredParts({ parts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text' && part.text?.trim()) {
          return (
            <div key={i} className="part-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
            </div>
          );
        }
        if (part.type === 'code') {
          return (
            <div key={i} className="part-code">
              <div className="part-code-header">
                <span className="part-code-lang">
                  {part.language === 'PYTHON' ? 'Python' : part.language}
                </span>
              </div>
              <pre className="part-code-body">
                <code>{part.code}</code>
              </pre>
            </div>
          );
        }
        if (part.type === 'result') {
          const ok = part.outcome === 'OUTCOME_OK';
          return (
            <div key={i} className="part-result">
              <div className="part-result-header">
                <span className={`part-result-badge ${ok ? 'ok' : 'err'}`}>
                  {ok ? '✓ Output' : '✗ Error'}
                </span>
              </div>
              <pre className="part-result-body">{part.output}</pre>
            </div>
          );
        }
        if (part.type === 'image') {
          return (
            <img
              key={i}
              src={`data:${part.mimeType};base64,${part.data}`}
              alt="Generated plot"
              className="part-image"
            />
          );
        }
        return null;
      })}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat({ username, firstName, lastName, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [csvContext, setCsvContext] = useState(null);     // pending attachment chip
  const [sessionCsvRows, setSessionCsvRows] = useState(null);    // parsed rows for JS tools
  const [sessionCsvHeaders, setSessionCsvHeaders] = useState(null); // headers for tool routing
  const [csvDataSummary, setCsvDataSummary] = useState(null);    // auto-computed column stats summary
  const [sessionSlimCsv, setSessionSlimCsv] = useState(null);   // key-columns CSV string sent directly to Gemini
  const [streaming, setStreaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'youtube'
  const [channelData, setChannelData] = useState(null); // downloaded YouTube JSON

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);
  // Set to true immediately before setActiveSessionId() is called during a send
  // so the messages useEffect knows to skip the reload (streaming is in progress).
  const justCreatedSessionRef = useRef(false);

  // On login: load sessions from DB; 'new' means an unsaved pending chat
  useEffect(() => {
    const init = async () => {
      const list = await getSessions(username);
      setSessions(list);
      setActiveSessionId('new'); // always start with a fresh empty chat on login
    };
    init();
  }, [username]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === 'new') {
      setMessages([]);
      return;
    }
    // If a session was just created during an active send, messages are already
    // in state and streaming is in progress — don't wipe them.
    if (justCreatedSessionRef.current) {
      justCreatedSessionRef.current = false;
      return;
    }
    setMessages([]);
    loadMessages(activeSessionId).then(setMessages);
  }, [activeSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenuId]);

  // ── Session management ──────────────────────────────────────────────────────

  const handleNewChat = () => {
    setActiveSessionId('new');
    setMessages([]);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
  };

  const handleSelectSession = (sessionId) => {
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    setInput('');
    setImages([]);
    setCsvContext(null);
    setSessionCsvRows(null);
    setSessionCsvHeaders(null);
  };

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation();
    setOpenMenuId(null);
    await deleteSession(sessionId);
    const remaining = sessions.filter((s) => s.id !== sessionId);
    setSessions(remaining);
    if (activeSessionId === sessionId) {
      setActiveSessionId(remaining.length > 0 ? remaining[0].id : 'new');
      setMessages([]);
    }
  };

  // ── File handling ───────────────────────────────────────────────────────────

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const fileToText = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];

    // Filter files by type - be strict about image detection
    const jsonFiles = files.filter((f) => 
      f.name.toLowerCase().endsWith('.json') || 
      f.type === 'application/json' ||
      f.type === 'text/json'
    );
    const csvFiles = files.filter((f) => 
      f.name.toLowerCase().endsWith('.csv') || 
      f.type === 'text/csv' ||
      f.type === 'application/csv'
    );
    // Only accept files that explicitly have image/ MIME type
    const imageFiles = files.filter((f) => 
      f.type && f.type.startsWith('image/') && 
      !f.name.toLowerCase().endsWith('.json') && 
      !f.name.toLowerCase().endsWith('.csv')
    );
    
    // Log unrecognized files for debugging
    const recognizedFiles = [...jsonFiles, ...csvFiles, ...imageFiles];
    const unrecognized = files.filter(f => !recognizedFiles.includes(f));
    if (unrecognized.length > 0) {
      console.warn('[File Upload] Unrecognized file types:', unrecognized.map(f => ({ name: f.name, type: f.type })));
    }

    if (jsonFiles.length > 0) {
      const text = await fileToText(jsonFiles[0]);
      try {
        const parsed = JSON.parse(text);
        // If it looks like YouTube channel data, load it
        if (parsed.videos && parsed.channel_name) {
          setChannelData(parsed);
          // Auto-send a message announcing the loaded data
          const announcementText = `I've loaded the YouTube channel data for "${parsed.channel_name}" (${parsed.video_count} videos). What would you like to analyze?`;
          const userMsg = { id: `u-${Date.now()}`, role: 'user', content: announcementText, timestamp: new Date().toISOString(), jsonFile: jsonFiles[0].name };
          setMessages((m) => [...m, userMsg]);
          return;
        }
      } catch { /* not valid JSON, ignore */ }
    }

    if (csvFiles.length > 0) {
      const file = csvFiles[0];
      const text = await fileToText(file);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: file.name, ...parsed });
        // Parse rows, add computed engagement col, build summary + slim CSV
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }

    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';

    // Filter files by type - be strict about image detection
    const jsonFiles = files.filter((f) => 
      f.name.toLowerCase().endsWith('.json') || 
      f.type === 'application/json' ||
      f.type === 'text/json'
    );
    const csvFiles = files.filter((f) => 
      f.name.toLowerCase().endsWith('.csv') || 
      f.type === 'text/csv' ||
      f.type === 'application/csv'
    );
    // Only accept files that explicitly have image/ MIME type
    const imageFiles = files.filter((f) => 
      f.type && f.type.startsWith('image/') && 
      !f.name.toLowerCase().endsWith('.json') && 
      !f.name.toLowerCase().endsWith('.csv')
    );
    
    // Log unrecognized files for debugging
    const recognizedFiles = [...jsonFiles, ...csvFiles, ...imageFiles];
    const unrecognized = files.filter(f => !recognizedFiles.includes(f));
    if (unrecognized.length > 0) {
      console.warn('[File Upload] Unrecognized file types:', unrecognized.map(f => ({ name: f.name, type: f.type })));
    }

    if (jsonFiles.length > 0) {
      const text = await fileToText(jsonFiles[0]);
      try {
        const parsed = JSON.parse(text);
        // If it looks like YouTube channel data, load it
        if (parsed.videos && parsed.channel_name) {
          setChannelData(parsed);
          // Auto-send a message announcing the loaded data
          const announcementText = `I've loaded the YouTube channel data for "${parsed.channel_name}" (${parsed.video_count} videos). What would you like to analyze?`;
          const userMsg = { id: `u-${Date.now()}`, role: 'user', content: announcementText, timestamp: new Date().toISOString(), jsonFile: jsonFiles[0].name };
          setMessages((m) => [...m, userMsg]);
          return;
        }
      } catch { /* not valid JSON, ignore */ }
    }

    if (csvFiles.length > 0) {
      const text = await fileToText(csvFiles[0]);
      const parsed = parseCSV(text);
      if (parsed) {
        setCsvContext({ name: csvFiles[0].name, ...parsed });
        const raw = parseCsvToRows(text);
        const { rows, headers } = enrichWithEngagement(raw.rows, raw.headers);
        setSessionCsvHeaders(headers);
        setSessionCsvRows(rows);
        setCsvDataSummary(computeDatasetSummary(rows, headers));
        setSessionSlimCsv(buildSlimCsv(rows, headers));
      }
    }
    if (imageFiles.length > 0) {
      const newImages = await Promise.all(
        imageFiles.map(async (f) => ({
          data: await fileToBase64(f),
          mimeType: f.type,
          name: f.name,
        }))
      );
      setImages((prev) => [...prev, ...newImages]);
    }
  };

  // ── Stop generation ─────────────────────────────────────────────────────────

  const handlePaste = async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    const newImages = await Promise.all(
      imageItems.map(
        (item) =>
          new Promise((resolve) => {
            const file = item.getAsFile();
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () =>
              resolve({ data: reader.result.split(',')[1], mimeType: file.type, name: 'pasted-image' });
            reader.readAsDataURL(file);
          })
      )
    );
    setImages((prev) => [...prev, ...newImages.filter(Boolean)]);
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  // ── Send message ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && !images.length && !csvContext) || streaming || !activeSessionId) return;

    // Lazily create the session in DB on the very first message
    let sessionId = activeSessionId;
    if (sessionId === 'new') {
      const title = chatTitle();
      const { id } = await createSession(username, 'lisa', title);
      sessionId = id;
      justCreatedSessionRef.current = true; // tell useEffect to skip the reload
      setActiveSessionId(id);
      setSessions((prev) => [{ id, agent: 'lisa', title, createdAt: new Date().toISOString(), messageCount: 0 }, ...prev]);
    }

    // ── Routing intent (computed first so we know whether Python/base64 is needed) ──
    // PYTHON_ONLY = things the client tools genuinely cannot produce
    const PYTHON_ONLY_KEYWORDS = /\b(regression|scatter|histogram|seaborn|matplotlib|numpy|time.?series|heatmap|box.?plot|violin|distribut|linear.?model|logistic|forecast|trend.?line)\b/i;
    const wantPythonOnly = PYTHON_ONLY_KEYWORDS.test(text);
    const wantCode = CODE_KEYWORDS.test(text) && !sessionCsvRows;
    const capturedCsv = csvContext;
    const hasCsvInSession = !!sessionCsvRows || !!capturedCsv;
    // Base64 is only worth sending when Gemini will actually run Python
    const needsBase64 = !!capturedCsv && wantPythonOnly;
    // YouTube tools take priority when channel data is loaded and no CSV is attached
    const useYoutubeTools = !!channelData && !capturedCsv;
    // Mode selection:
    //   useYoutubeTools — YouTube channel JSON loaded → client-side YouTube tools
    //   useTools        — CSV loaded + no Python needed → client-side JS tools (free, fast)
    //   useCodeExecution — Python explicitly needed (regression, histogram, etc.)
    //   else            — Google Search streaming
    const useTools = !!sessionCsvRows && !wantPythonOnly && !wantCode && !capturedCsv && !channelData;
    const useCodeExecution = !useYoutubeTools && (wantPythonOnly || wantCode);

    // ── Build prompt ─────────────────────────────────────────────────────────
    // sessionSummary: auto-computed column stats, included with every message
    const sessionSummary = csvDataSummary || '';
    // slimCsv: key columns only (text, type, metrics, engagement) as plain readable CSV
    // ~6-10k tokens — Gemini reads it directly so it can answer from context or call tools
    const slimCsvBlock = sessionSlimCsv
      ? `\n\nFull dataset (key columns):\n\`\`\`csv\n${sessionSlimCsv}\n\`\`\``
      : '';

    const csvPrefix = capturedCsv
      ? needsBase64
        // Python path: send base64 so Gemini can load it with pandas
        ? `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

IMPORTANT — to load the full data in Python use this exact pattern:
\`\`\`python
import pandas as pd, io, base64
df = pd.read_csv(io.BytesIO(base64.b64decode("${capturedCsv.base64}")))
\`\`\`

---

`
        // Standard path: plain CSV text — no encoding needed
        : `[CSV File: "${capturedCsv.name}" | ${capturedCsv.rowCount} rows | Columns: ${capturedCsv.headers.join(', ')}]

${sessionSummary}${slimCsvBlock}

---

`
      : sessionSummary
      ? `[CSV columns: ${sessionCsvHeaders?.join(', ')}]\n\n${sessionSummary}\n\n---\n\n`
      : '';

    // userContent  — displayed in bubble and stored in MongoDB (never contains base64)
    // promptForGemini — sent to the Gemini API (may contain the full prefix)
    const userContent = text || (images.length ? '(Image)' : '(CSV attached)');
    const nameContext = (firstName || lastName) ? `[User: ${firstName} ${lastName}]\n\n` : '';
    const channelContext = channelData
      ? `[YouTube Channel Data Loaded: "${channelData.channel_name}" | ${channelData.video_count} videos | Downloaded: ${new Date(channelData.downloaded_at).toLocaleDateString()}]\n\nVideo list (title, views, likes, comments, date):\n${channelData.videos.slice(0, 50).map((v, i) => `${i+1}. "${v.title}" | views:${v.view_count} | likes:${v.like_count} | comments:${v.comment_count} | date:${v.release_date?.slice(0,10)} | url:${v.video_url}`).join('\n')}\n\n`
      : '';
    const promptForGemini = nameContext + channelContext + csvPrefix + (text || (images.length ? 'What do you see in this image?' : 'Please analyze this CSV data.'));

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: new Date().toISOString(),
      images: [...images],
      csvName: capturedCsv?.name || null,
    };

    setMessages((m) => [...m, userMsg]);
    setInput('');
    const capturedImages = [...images];
    setImages([]);
    setCsvContext(null);
    setStreaming(true);

    // Validate images before sending - only send actual image files with valid data
    const validImages = capturedImages.filter((img) => {
      // Check MIME type
      if (!img.mimeType || !img.mimeType.startsWith('image/')) {
        console.warn('[Chat] Filtered out non-image file:', { mimeType: img.mimeType, name: img.name });
        return false;
      }
      
      // Check if data exists and is not empty
      if (!img.data || typeof img.data !== 'string' || img.data.trim() === '') {
        console.warn('[Chat] Filtered out image with empty data:', { mimeType: img.mimeType, name: img.name });
        return false;
      }
      
      // Validate base64 format (basic check)
      const base64Regex = /^[A-Za-z0-9+/=]+$/;
      if (!base64Regex.test(img.data)) {
        console.warn('[Chat] Filtered out image with invalid base64:', { mimeType: img.mimeType, name: img.name });
        return false;
      }
      
      // Check supported MIME types for Gemini
      const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
      if (!supportedTypes.includes(img.mimeType.toLowerCase())) {
        console.warn('[Chat] Filtered out unsupported image type:', { mimeType: img.mimeType, name: img.name });
        return false;
      }
      
      // Check data size (Gemini has limits - roughly 4MB per image)
      const estimatedSize = (img.data.length * 3) / 4; // approximate base64 to bytes
      if (estimatedSize > 4 * 1024 * 1024) {
        console.warn('[Chat] Filtered out image that is too large:', { 
          mimeType: img.mimeType, 
          name: img.name, 
          estimatedSize: `${(estimatedSize / 1024 / 1024).toFixed(2)}MB` 
        });
        return false;
      }
      
      return true;
    });

    if (capturedImages.length > 0 && validImages.length === 0) {
      console.error('[Chat] All images were filtered out. Original count:', capturedImages.length);
    }

    // Store display text only — base64 is never persisted
    await saveMessage(sessionId, 'user', userContent, validImages.length ? validImages : null);

    const imageParts = validImages.map((img) => ({ mimeType: img.mimeType, data: img.data }));

    // History: plain display text only — session summary handles CSV context on every message
    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'model')
      .map((m) => ({ role: m.role, content: m.content || messageText(m) }));

    const assistantId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: assistantId, role: 'model', content: '', timestamp: new Date().toISOString() },
    ]);

    abortRef.current = false;

    let fullContent = '';
    let groundingData = null;
    let structuredParts = null;
    let toolCharts = [];
    let toolCalls = [];

    try {
      if (useYoutubeTools) {
        // ── YouTube tools path ────────────────────────────────────────────────
        const userFullNameYT = [firstName, lastName].filter(Boolean).join(' ');
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithYoutubeTools(
          history,
          promptForGemini,
          channelData,
          (toolName, args) => executeYoutubeTool(toolName, args, channelData),
          userFullNameYT
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: fullContent, charts: toolCharts.length ? toolCharts : undefined, toolCalls: toolCalls.length ? toolCalls : undefined }
              : msg
          )
        );
      } else if (useTools) {
        // ── Function-calling path: Gemini picks tool + args, JS executes ──────
        console.log('[Chat] useTools=true | rows:', sessionCsvRows.length, '| headers:', sessionCsvHeaders);
        const userFullName = [firstName, lastName].filter(Boolean).join(' ');
        const { text: answer, charts: returnedCharts, toolCalls: returnedCalls } = await chatWithCsvTools(
          history,
          promptForGemini,
          sessionCsvHeaders,
          (toolName, args) => executeTool(toolName, args, sessionCsvRows),
          userFullName
        );
        fullContent = answer;
        toolCharts = returnedCharts || [];
        toolCalls = returnedCalls || [];
        console.log('[Chat] returnedCharts:', JSON.stringify(toolCharts));
        console.log('[Chat] toolCalls:', toolCalls.map((t) => t.name));
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  content: fullContent,
                  charts: toolCharts.length ? toolCharts : undefined,
                  toolCalls: toolCalls.length ? toolCalls : undefined,
                }
              : msg
          )
        );
      } else {
        // ── Streaming path: code execution or search ─────────────────────────
        const userFullName2 = [firstName, lastName].filter(Boolean).join(' ');
        for await (const chunk of streamChat(history, promptForGemini, imageParts, useCodeExecution, userFullName2)) {
          if (abortRef.current) break;
          if (chunk.type === 'text') {
            fullContent += chunk.text;
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: fullContent } : msg))
            );
          } else if (chunk.type === 'fullResponse') {
            structuredParts = chunk.parts;
            setMessages((m) =>
              m.map((msg) =>
                msg.id === assistantId ? { ...msg, content: '', parts: structuredParts } : msg
              )
            );
          } else if (chunk.type === 'grounding') {
            groundingData = chunk.data;
          }
        }
      }
    } catch (err) {
      const errText = `Error: ${err.message}`;
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, content: errText } : msg))
      );
      fullContent = errText;
    }

    if (groundingData) {
      setMessages((m) =>
        m.map((msg) => (msg.id === assistantId ? { ...msg, grounding: groundingData } : msg))
      );
    }

    // Save plain text + any tool charts to DB
    const savedContent = structuredParts
      ? structuredParts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      : fullContent;
    await saveMessage(
      sessionId,
      'model',
      savedContent,
      null,
      toolCharts.length ? toolCharts : null,
      toolCalls.length ? toolCalls : null
    );

    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, messageCount: s.messageCount + 2 } : s))
    );

    setStreaming(false);
    inputRef.current?.focus();
  };

  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d) / 86400000);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 0) return `Today · ${time}`;
    if (diffDays === 1) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="chat-layout">
      {/* ── Sidebar ──────────────────────────────── */}
      <aside className="chat-sidebar">
        <div className="sidebar-top">
          <h1 className="sidebar-title">Chat</h1>
          <button className="new-chat-btn" onClick={handleNewChat}>
            + New Chat
          </button>
        </div>

        <div className="sidebar-sessions">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`sidebar-session${session.id === activeSessionId ? ' active' : ''}`}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="sidebar-session-info">
                <span className="sidebar-session-title">{session.title}</span>
                <span className="sidebar-session-date">{formatDate(session.createdAt)}</span>
              </div>
              <div
                className="sidebar-session-menu"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === session.id ? null : session.id);
                }}
              >
                <span className="three-dots">⋮</span>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-delete-btn"
                      onClick={(e) => handleDeleteSession(session.id, e)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-username">{firstName ? `${firstName} ${lastName}` : username}</span>
          <button onClick={onLogout} className="sidebar-logout">
            Log out
          </button>
        </div>
      </aside>

      {/* ── Main chat area ───────────────────────── */}
      <div className="chat-main">
        <>
        <header className="chat-header">
          <h2 className="chat-header-title">{activeTab === 'youtube' ? 'YouTube Channel Download' : (activeSession?.title ?? 'New Chat')}</h2>
          <div className="chat-tabs">
            <button
              className={`chat-tab${activeTab === 'chat' ? ' active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              💬 Chat
            </button>
            <button
              className={`chat-tab${activeTab === 'youtube' ? ' active' : ''}`}
              onClick={() => setActiveTab('youtube')}
            >
              📥 YouTube Channel Download
            </button>
          </div>
        </header>

        {activeTab === 'youtube' ? (
          <YouTubeDownload onDataDownloaded={(data) => { setChannelData(data); setActiveTab('chat'); }} />
        ) : (<>
        <div
          className={`chat-messages${dragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-meta">
                <span className="chat-msg-role">{m.role === 'user' ? username : 'Lisa'}</span>
                <span className="chat-msg-time">
                  {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              {/* CSV badge on user messages */}
              {m.csvName && (
                <div className="msg-csv-badge">
                  📄 {m.csvName}
                </div>
              )}

              {/* Image attachments */}
              {m.images?.length > 0 && (
                <div className="chat-msg-images">
                  {m.images.map((img, i) => (
                    <img key={i} src={`data:${img.mimeType};base64,${img.data}`} alt="" className="chat-msg-thumb" />
                  ))}
                </div>
              )}

              {/* Message body */}
              <div className="chat-msg-content">
                {m.role === 'model' ? (
                  m.parts ? (
                    <StructuredParts parts={m.parts} />
                  ) : m.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  ) : (
                    <span className="thinking-dots">
                      <span /><span /><span />
                    </span>
                  )
                ) : (
                  m.content
                )}
              </div>

              {/* Tool calls log */}
              {m.toolCalls?.length > 0 && (
                <details className="tool-calls-details">
                  <summary className="tool-calls-summary">
                    🔧 {m.toolCalls.length} tool{m.toolCalls.length > 1 ? 's' : ''} used
                  </summary>
                  <div className="tool-calls-list">
                    {m.toolCalls.map((tc, i) => (
                      <div key={i} className="tool-call-item">
                        <span className="tool-call-name">{tc.name}</span>
                        <span className="tool-call-args">{JSON.stringify(tc.args)}</span>
                        {tc.result && !tc.result._chartType && (
                          <span className="tool-call-result">
                            → {JSON.stringify(tc.result).slice(0, 200)}
                            {JSON.stringify(tc.result).length > 200 ? '…' : ''}
                          </span>
                        )}
                        {tc.result?._chartType && (
                          <span className="tool-call-result">→ rendered chart</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Engagement charts from tool calls */}
              {m.charts?.map((chart, ci) =>
                chart._chartType === 'engagement' ? (
                  <EngagementChart
                    key={ci}
                    data={chart.data}
                    metricColumn={chart.metricColumn}
                  />
                ) : chart._toolType ? (
                  <YoutubeToolOutput key={ci} chart={chart} />
                ) : null
              )}

              {/* Search sources */}
              {m.grounding?.groundingChunks?.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="sources-label">Sources</span>
                  <div className="sources-list">
                    {m.grounding.groundingChunks.map((chunk, i) =>
                      chunk.web ? (
                        <a key={i} href={chunk.web.uri} target="_blank" rel="noreferrer" className="source-link">
                          {chunk.web.title || chunk.web.uri}
                        </a>
                      ) : null
                    )}
                  </div>
                  {m.grounding.webSearchQueries?.length > 0 && (
                    <div className="sources-queries">
                      Searched: {m.grounding.webSearchQueries.join(' · ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {dragOver && <div className="chat-drop-overlay">Drop CSV or images here</div>}

        {/* ── Input area ── */}
        <div className="chat-input-area">
          {/* CSV chip */}
          {csvContext && (
            <div className="csv-chip">
              <span className="csv-chip-icon">📄</span>
              <span className="csv-chip-name">{csvContext.name}</span>
              <span className="csv-chip-meta">
                {csvContext.rowCount} rows · {csvContext.headers.length} cols
              </span>
              <button className="csv-chip-remove" onClick={() => setCsvContext(null)} aria-label="Remove CSV">×</button>
            </div>
          )}

          {/* Image previews */}
          {images.length > 0 && (
            <div className="chat-image-previews">
              {images.map((img, i) => (
                <div key={i} className="chat-img-preview">
                  <img src={`data:${img.mimeType};base64,${img.data}`} alt="" />
                  <button type="button" onClick={() => removeImage(i)} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.csv,text/csv,.json,application/json"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />

          <div className="chat-input-row">
            <button
              type="button"
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              title="Attach image or CSV"
            >
              📎
            </button>
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask a question, request analysis, or write & run code…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              onPaste={handlePaste}
              disabled={streaming}
            />
            {streaming ? (
              <button onClick={handleStop} className="stop-btn">
                ■ Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() && !images.length && !csvContext}
              >
                Send
              </button>
            )}
          </div>
        </div>
        </>)}
        </>
      </div>
    </div>
  );
}