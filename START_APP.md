# How to Start the App Locally

## Quick Start

Open a terminal in this directory and run:

```bash
npm start
```

This will start both the backend (port 3001) and frontend (port 3000).

## If That Doesn't Work

### Option 1: Start them separately

**Terminal 1 - Backend:**
```bash
npm run server
```

**Terminal 2 - Frontend:**
```bash
npm run client
```

### Option 2: Check for errors

1. Make sure you're in the project directory:
   ```bash
   cd "/Users/beebee/Documents/AI for Social media/HW5/Youtube-chatapp"
   ```

2. Install dependencies (if needed):
   ```bash
   npm install
   ```

3. Check if ports are free:
   ```bash
   lsof -ti:3000  # Should return nothing
   lsof -ti:3001  # Should return nothing
   ```

4. If ports are in use, kill the processes:
   ```bash
   lsof -ti:3000 | xargs kill -9
   lsof -ti:3001 | xargs kill -9
   ```

5. Then start the app:
   ```bash
   npm start
   ```

## What to Expect

- Backend will start on: http://localhost:3001
- Frontend will start on: http://localhost:3000
- The browser should open automatically
- If not, manually go to http://localhost:3000

## Common Issues

**"Port already in use"**
- Kill the process using the port (see Option 2 above)

**"Cannot find module"**
- Run `npm install` to install dependencies

**"Connection refused"**
- Make sure both backend and frontend are running
- Check terminal for error messages

## Environment Variables

Make sure your `.env` file has:
```
REACT_APP_GEMINI_API_KEY=AIzaSyCIUw9mSg6DTrqBwSUrDfvMrb1K5f4wXdc
REACT_APP_MONGODB_URI=your_mongodb_connection_string
```
