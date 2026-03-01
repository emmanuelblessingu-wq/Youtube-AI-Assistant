# Debug Image Generation Issues

## Where to Check Logs

**IMPORTANT:** Hugging Face token logs appear in the **BACKEND TERMINAL**, not the browser console!

### Backend Terminal (where `npm run server` or `npm start` is running)

When the backend starts, you should see:
```
[DEBUG] Loaded env vars: REACT_APP_GEMINI_API_KEY, REACT_APP_MONGODB_URI, HUGGINGFACE_API_TOKEN, ...
[DEBUG] ✅ HUGGINGFACE_API_TOKEN is loaded (length: 51)
```

When generating an image, you should see:
```
[Image Generation] Generating image for prompt: ...
[Image Generation] Using Hugging Face API token (length: 51)
[Image Generation] Calling Hugging Face API...
```

### Browser Console (F12)

You'll see Gemini API logs here, but NOT Hugging Face logs.

## Common Issues

### 1. Token Not Loaded

**Symptom:** Backend shows `[DEBUG] ⚠️ HUGGINGFACE_API_TOKEN is NOT loaded`

**Fix:**
- Check `.env` file has: `HUGGINGFACE_API_TOKEN=hf_your_token_here`
- No spaces around `=`
- No quotes around value
- Save the file
- **RESTART the backend server** (Ctrl+C, then `npm start`)

### 2. 401 Unauthorized Error

**Symptom:** Error message says "401" or "Unauthorized"

**Fix:**
- Token might be invalid or expired
- Get a new token from https://huggingface.co/settings/tokens
- Update `.env` file
- Restart backend

### 3. Backend Not Restarted

**Symptom:** Token is in `.env` but backend logs show it's not loaded

**Fix:**
- **MUST restart backend** after changing `.env`
- Stop: Ctrl+C
- Start: `npm start` or `npm run server`

### 4. Wrong Terminal

**Symptom:** Can't find the logs

**Fix:**
- Backend logs = Terminal where `npm start` or `npm run server` is running
- Frontend logs = Browser console (F12)
- They are DIFFERENT!

## Quick Test

1. Check backend terminal for: `[DEBUG] ✅ HUGGINGFACE_API_TOKEN is loaded`
2. Try generating an image
3. Check backend terminal for: `[Image Generation] Using Hugging Face API token`
4. If you see errors, copy them from the backend terminal
