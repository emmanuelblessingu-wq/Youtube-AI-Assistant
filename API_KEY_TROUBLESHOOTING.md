# API Key Troubleshooting Guide

## ⚠️ CRITICAL: React Environment Variables

**`REACT_APP_*` variables are baked into the JavaScript bundle at START TIME.**

This means:
- ✅ Changing `.env` file → **MUST restart the app** (`npm start`)
- ✅ Changing Render environment → **MUST redeploy** (Clear build cache & deploy)
- ❌ Just saving `.env` → **Won't work** until you restart
- ❌ Just updating Render → **Won't work** until you redeploy

## How to Verify Your API Key is Loaded

1. **Open browser console** (F12)
2. **Send a message** in chat
3. **Look for these logs:**
   ```
   [Gemini] Using model: models/gemini-2.5-flash
   [Gemini] API key present: true Length: 39
   [Gemini] API key preview: AIzaSyCIUw...Xdc
   ```

4. **If you see:**
   - `API key present: false` → Key not in `.env` or app not restarted
   - `Length: 0` or `undefined` → Key not loaded
   - `Length: 39` → Key is loaded (should work)

## Step-by-Step Fix

### For Local Development:

1. **Stop the app** (Ctrl+C in terminal)

2. **Update `.env` file:**
   ```
   REACT_APP_GEMINI_API_KEY=your_new_key_here
   ```
   - Make sure NO spaces around the `=`
   - Make sure NO quotes around the value
   - Make sure the file is in the project root (same folder as `package.json`)

3. **Restart the app:**
   ```bash
   npm start
   ```

4. **Wait for compilation** (you'll see "Compiled successfully!")

5. **Test in browser** - check console for API key logs

### For Production (Render):

1. **Go to Render dashboard**
2. **Frontend service** → **Environment** tab
3. **Update `REACT_APP_GEMINI_API_KEY`**
4. **Save**
5. **Manual Deploy** → **Clear build cache & deploy**
6. **Wait 3-5 minutes** for deployment
7. **Test the live site**

## Common Mistakes

❌ **Updating `.env` but not restarting** → Old key still in memory
❌ **Updating Render but not redeploying** → Old key still in bundle
❌ **Spaces in `.env` file** → `REACT_APP_GEMINI_API_KEY = key` (wrong)
✅ **Correct format:** `REACT_APP_GEMINI_API_KEY=key` (no spaces)

## Verify Key Format

A valid Gemini API key:
- Starts with `AIzaSy`
- Is exactly 39 characters long
- Has no spaces or special characters (except letters/numbers)

## If Still Not Working

1. **Check browser console** for the API key preview
2. **Compare** the preview with your actual key
3. **If different** → App is using cached/old key
4. **Solution:** Hard restart (kill all node processes, clear cache, restart)

## Quick Test

Run this in browser console after updating:
```javascript
console.log('API Key:', process.env.REACT_APP_GEMINI_API_KEY?.substring(0, 10) + '...');
```

If it shows `undefined` or old key → App needs restart/redeploy.
