# 🚨 CRITICAL: Deployment Checklist

## The Issue
Your code is correct (`gemini-1.5-flash`), but the deployed app is still using the old code (`gemini-pro`).

## What You MUST Do

### Step 1: Verify Render Auto-Deploy is ON
1. Go to https://dashboard.render.com
2. Open your **frontend service** (chatapp-frontend)
3. Go to **Settings** tab
4. Check **Auto-Deploy** - it should be set to **"Yes"**
5. If it's "No", turn it ON and save

### Step 2: Force a Fresh Deploy
1. In your frontend service, click **"Manual Deploy"**
2. Select **"Clear build cache & deploy"** (CRITICAL - must clear cache)
3. Click **"Deploy latest commit"**
4. Wait 3-5 minutes for deployment to complete

### Step 3: Verify Deployment
1. Check the **Logs** tab in Render
2. Look for: `"Using model: gemini-1.5-flash"` in build logs
3. Make sure deployment status shows **"Live"** (green)

### Step 4: Clear Browser Cache
1. Open your site URL
2. Press **Ctrl+Shift+R** (Windows) or **Cmd+Shift+R** (Mac) to hard refresh
3. Or open in **Incognito/Private window**

### Step 5: Test
1. Open browser console (F12)
2. Send a message "hi"
3. Check console - you should see:
   - `[Gemini] Using model: gemini-1.5-flash`
   - NOT `gemini-pro`

## If Still Not Working

### Check 1: Is Render Actually Deploying?
- Go to Render → Your service → **Events** tab
- Look for recent deployments
- If no deployments, Render isn't connected to GitHub properly

### Check 2: Verify GitHub Connection
- Render → Settings → **GitHub** section
- Make sure it's connected to the right repo
- Make sure it's watching the `main` branch

### Check 3: Check Build Logs
- Render → Logs tab
- Look for errors during build
- Make sure build completes successfully

## Quick Test
After deployment, open browser console and run:
```javascript
// This should show the model name
fetch('/static/js/main.*.js')
  .then(r => r.text())
  .then(t => console.log(t.includes('gemini-1.5-flash') ? '✅ Correct model' : '❌ Wrong model'))
```

## Emergency Fix
If nothing works, try:
1. Delete the frontend service in Render
2. Recreate it from the same GitHub repo
3. Set all environment variables again
4. Deploy
