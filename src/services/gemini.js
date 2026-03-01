import { GoogleGenerativeAI } from '@google/generative-ai';
import { CSV_TOOL_DECLARATIONS, YOUTUBE_TOOL_DECLARATIONS } from './csvTools';

const genAI = new GoogleGenerativeAI(process.env.REACT_APP_GEMINI_API_KEY || '');

// Model name for Gemini API v1beta
// The error shows gemini-1.5-flash returns 404 for v1beta
// Trying models/gemini-1.5-flash format or gemini-1.5-pro
// If this doesn't work, the API key may not have access to these models
const MODEL = 'models/gemini-1.5-flash';

const SEARCH_TOOL = { googleSearch: {} };
const CODE_EXEC_TOOL = { codeExecution: {} };

export const CODE_KEYWORDS = /\b(plot|chart|graph|analyz|statistic|regression|correlat|histogram|visualiz|calculat|compute|run code|write code|execute|pandas|numpy|matplotlib|csv|data)\b/i;

let cachedPrompt = null;

async function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    const res = await fetch('/prompt_chat.txt');
    cachedPrompt = res.ok ? (await res.text()).trim() : '';
  } catch {
    cachedPrompt = '';
  }
  return cachedPrompt;
}

// Yields:
//   { type: 'text', text }           — streaming text chunks
//   { type: 'fullResponse', parts }  — when code was executed; replaces streamed text
//   { type: 'grounding', data }      — Google Search metadata
//
// fullResponse parts: { type: 'text'|'code'|'result'|'image', ... }
//
// useCodeExecution: pass true to use codeExecution tool (CSV/analysis),
//                   false (default) to use googleSearch tool.
// Note: Gemini does not support both tools simultaneously.
export const streamChat = async function* (history, newMessage, imageParts = [], useCodeExecution = false, userFullName = '') {
  // Check if API key is set
  const apiKey = process.env.REACT_APP_GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Gemini API key is not configured. Please set REACT_APP_GEMINI_API_KEY in your Render environment variables and redeploy.');
  }
  
  // Log for debugging (will show in browser console)
  console.log('[Gemini] Using model:', MODEL);
  console.log('[Gemini] API key present:', !!apiKey, 'Length:', apiKey?.length);

  let systemInstruction = await loadSystemPrompt();
  if (userFullName) systemInstruction += `\n\nThe user's full name is ${userFullName}. Address them by their first name in your first response of each conversation.`;
  const tools = useCodeExecution ? [CODE_EXEC_TOOL] : [SEARCH_TOOL];
  
  try {
    const model = genAI.getGenerativeModel({
      model: MODEL,
      tools,
    });

    const baseHistory = history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content || '' }],
    }));

    const chatHistory = systemInstruction
      ? [
          {
            role: 'user',
            parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
          },
          { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
          ...baseHistory,
        ]
      : baseHistory;

    const chat = model.startChat({ history: chatHistory });

    const parts = [
      { text: newMessage },
      ...imageParts.map((img) => ({
        inlineData: { mimeType: img.mimeType || 'image/png', data: img.data },
      })),
    ].filter((p) => p.text !== undefined || p.inlineData !== undefined);

    const result = await chat.sendMessageStream(parts);

    // Stream text chunks for live display
    for await (const chunk of result.stream) {
      const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
      for (const part of chunkParts) {
        if (part.text) yield { type: 'text', text: part.text };
      }
    }

    // After stream: inspect all response parts
    const response = await result.response;
    const allParts = response.candidates?.[0]?.content?.parts || [];

    const hasCodeExecution = allParts.some(
      (p) =>
        p.executableCode ||
        p.codeExecutionResult ||
        (p.inlineData && p.inlineData.mimeType?.startsWith('image/'))
    );

    if (hasCodeExecution) {
      // Build ordered structured parts to replace the streamed text
      const structuredParts = allParts
        .map((p) => {
          if (p.text) return { type: 'text', text: p.text };
          if (p.executableCode)
            return {
              type: 'code',
              language: p.executableCode.language || 'PYTHON',
              code: p.executableCode.code,
            };
          if (p.codeExecutionResult)
            return {
              type: 'result',
              outcome: p.codeExecutionResult.outcome,
              output: p.codeExecutionResult.output,
            };
          if (p.inlineData)
            return { type: 'image', mimeType: p.inlineData.mimeType, data: p.inlineData.data };
          return null;
        })
        .filter(Boolean);

      yield { type: 'fullResponse', parts: structuredParts };
    }

    // Grounding metadata (search sources)
    const grounding = response.candidates?.[0]?.groundingMetadata;
    if (grounding) {
      console.log('[Search grounding]', grounding);
      yield { type: 'grounding', data: grounding };
    }
  } catch (error) {
    console.error('[Gemini API Error]', error);
    console.error('[Gemini API Error Details]', {
      model: MODEL,
      apiKeyPresent: !!process.env.REACT_APP_GEMINI_API_KEY,
      errorMessage: error.message,
      errorStack: error.stack
    });
    
    // Provide a more helpful error message
    if (error.message?.includes('404') || error.message?.includes('not found')) {
      const errorMsg = `Gemini API Error: Model "${MODEL}" returned 404.\n\n` +
        `This usually means:\n` +
        `1. Your API key is invalid or expired - Get a new one at https://aistudio.google.com/apikey\n` +
        `2. The API key isn't set in Render - Check Environment tab in Render dashboard\n` +
        `3. You need to REDEPLOY after setting the key - Manual Deploy → Clear build cache & deploy\n` +
        `4. The model name might be wrong - Currently using: ${MODEL}\n\n` +
        `Check browser console for more details.`;
      throw new Error(errorMsg);
    }
    
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      throw new Error('Gemini API Error: Unauthorized. Your API key is invalid or expired. Please get a new key from https://aistudio.google.com/apikey and update it in Render.');
    }
    
    throw error;
  }
};

// ── Function-calling chat for CSV tools ───────────────────────────────────────
// Gemini picks a tool + args → executeFn runs it client-side (free) → Gemini
// receives the result and returns a natural-language answer.
//
// executeFn(toolName, args) → plain JS object with the result
// Returns the final text response from the model.

export const chatWithCsvTools = async (history, newMessage, csvHeaders, executeFn, userFullName = '') => {
  let systemInstruction = await loadSystemPrompt();
  if (userFullName) systemInstruction += `\n\nThe user's full name is ${userFullName}. Address them by their first name when relevant.`;
  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [{ functionDeclarations: CSV_TOOL_DECLARATIONS }],
  });

  const baseHistory = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        {
          role: 'user',
          parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }],
        },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  // Include column names so the model can match user intent to exact column names
  const msgWithContext = csvHeaders?.length
    ? `[CSV columns: ${csvHeaders.join(', ')}]\n\n${newMessage}`
    : newMessage;

  let response = (await chat.sendMessage(msgWithContext)).response;

  // Accumulate chart payloads and a log of every tool call made
  const charts = [];
  const toolCalls = [];

  // Function-calling loop (Gemini may chain multiple tool calls)
  for (let round = 0; round < 5; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    console.log('[CSV Tool]', name, args);
    const toolResult = executeFn(name, args);
    console.log('[CSV Tool result]', toolResult);

    // Log the call for persistence
    toolCalls.push({ name, args, result: toolResult });

    // Capture chart payloads so the UI can render them
    if (toolResult?._chartType) {
      charts.push(toolResult);
    }

    response = (
      await chat.sendMessage([
        { functionResponse: { name, response: { result: toolResult } } },
      ])
    ).response;
  }

  return { text: response.text(), charts, toolCalls };
};


// ── YouTube tools chat function ───────────────────────────────────────────────
export const chatWithYoutubeTools = async (history, newMessage, channelData, executeFn, userFullName = '') => {
  let systemInstruction = await loadSystemPrompt();
  if (userFullName) systemInstruction += `\n\nThe user's full name is ${userFullName}. Address them by their first name.`;

  const model = genAI.getGenerativeModel({
    model: MODEL,
    tools: [{ functionDeclarations: YOUTUBE_TOOL_DECLARATIONS }],
  });

  const baseHistory = history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content || '' }],
  }));

  const chatHistory = systemInstruction
    ? [
        { role: 'user', parts: [{ text: `Follow these instructions in every response:\n\n${systemInstruction}` }] },
        { role: 'model', parts: [{ text: "Got it! I'll follow those instructions." }] },
        ...baseHistory,
      ]
    : baseHistory;

  const chat = model.startChat({ history: chatHistory });

  let response = (await chat.sendMessage(newMessage)).response;

  const charts = [];
  const toolCalls = [];

  for (let round = 0; round < 5; round++) {
    const parts = response.candidates?.[0]?.content?.parts || [];
    const funcCall = parts.find((p) => p.functionCall);
    if (!funcCall) break;

    const { name, args } = funcCall.functionCall;
    const toolResult = executeFn(name, args);
    toolCalls.push({ name, args, result: toolResult });

    if (toolResult?._toolType === 'chart' || toolResult?._toolType === 'videoCard' ||
        toolResult?._toolType === 'stats' || toolResult?._toolType === 'generateImage') {
      charts.push(toolResult);
    }

    response = (
      await chat.sendMessage([{ functionResponse: { name, response: { result: toolResult } } }])
    ).response;
  }

  return { text: response.text(), charts, toolCalls };
};