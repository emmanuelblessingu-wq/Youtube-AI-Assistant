# How to Check Your Gemini API Key

## Step 1: Verify Key is Valid
1. Go to https://aistudio.google.com/apikey
2. Check if your key is still active
3. Look for any warnings or errors
4. Check your usage/quota limits

## Step 2: Test the Key Directly
Open browser console and run:
```javascript
fetch('https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_API_KEY')
  .then(r => r.json())
  .then(console.log)
```
Replace `YOUR_API_KEY` with your actual key.

This will show:
- If the key is valid
- What models are available
- Any error messages

## Step 3: Check Render Environment
1. Go to Render dashboard
2. Open your frontend service
3. Go to Environment tab
4. Verify `REACT_APP_GEMINI_API_KEY` is set
5. Copy the value and verify it matches your Google AI Studio key

## Step 4: Check Model Availability
The error says model not found. Try these models in order:
1. `gemini-1.5-flash-latest` (current)
2. `gemini-1.5-pro-latest`
3. `gemini-pro`
4. `models/gemini-1.5-flash`

## Most Common Issue
**The API key works locally but isn't set in Render production environment.**

Solution: Set it in Render and redeploy.
