# Setting Up Your GitHub Repository

## Step 1: Create a New Repository on GitHub

1. Go to https://github.com/new
2. **Repository name**: `youtube-chatapp` (or any name you prefer)
3. **Description**: "YouTube Chat App with Gemini AI, MongoDB, and YouTube data analysis"
4. **Visibility**: Choose Public or Private
5. **DO NOT** check any of these boxes:
   - ❌ Add a README file
   - ❌ Add .gitignore
   - ❌ Choose a license
   
   (We already have these files in the project)

6. Click **"Create repository"**

## Step 2: Connect Your Local Repository

After creating the repository, GitHub will show you a page with setup instructions. 

**Copy the repository URL** (it will look like):
- `https://github.com/YOUR_USERNAME/youtube-chatapp.git` (HTTPS)
- or `git@github.com:YOUR_USERNAME/youtube-chatapp.git` (SSH)

## Step 3: Run These Commands

Once you have the repository URL, run these commands in your terminal:

```bash
cd "/Users/beebee/Documents/AI for Social media/HW5/Youtube-chatapp"

# Add your GitHub repository as the remote origin
git remote add origin YOUR_REPOSITORY_URL_HERE

# Rename branch to main (if not already)
git branch -M main

# Push your code to GitHub
git push -u origin main
```

Replace `YOUR_REPOSITORY_URL_HERE` with the actual URL from Step 2.

## Alternative: I Can Help You Push

If you provide me with your repository URL, I can run these commands for you automatically!

---

**Note**: Your `.env` file is already in `.gitignore`, so your API keys won't be pushed to GitHub. Make sure to add your environment variables to your deployment platform (like Render) when you deploy.
