# Quick Start Guide

## Current Setup

✅ **Backend is running correctly!**
- Token loaded: `HUGGINGFACE_API_TOKEN` ✅
- MongoDB connected ✅
- Server on `http://localhost:3001` ✅

## Next Steps

### 1. Start the Frontend (if not already running)

If you see a port conflict, you have two options:

**Option A: Kill the existing process and restart**
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Then start frontend
npm run client
```

**Option B: Use the existing frontend**
- If the frontend is already running, just use it!
- Go to `http://localhost:3000` in your browser

### 2. Test Image Generation

1. Open `http://localhost:3000` in your browser
2. Log in if needed
3. In the chat, type: **"generate an image of a cat"**
4. **Watch the backend terminal** (the one showing `Server on http://localhost:3001`)

### 3. What to Look For

In the **backend terminal**, you should see:

```
[Image Generation] Generating image for prompt: ...
[Image Generation] Calling Hugging Face API...
[Image Generation] URL: https://api-inference.huggingface.co/models/...
[Image Generation] Response status: 200
[Image Generation] Image generated successfully, size: ...
```

**If you see errors**, copy them from the backend terminal and share them.

## Troubleshooting

### Port 3000 Already in Use

If you see "Something is already running on port 3000":
- The frontend is probably already running
- Just go to `http://localhost:3000` in your browser
- Or kill it: `lsof -ti:3000 | xargs kill -9`

### Image Generation Takes Time

- First request: 1-2 minutes (model needs to load)
- Subsequent requests: 20-40 seconds
- Be patient! Watch the backend terminal for progress.
