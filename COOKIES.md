# YouTube Cookies for yt-dlp

Some YouTube videos are restricted to authenticated users (age-gated, region-restricted, or under anti-bot measures). To download these videos with the analysis worker, you need to provide authenticated YouTube cookies.

## Quick Start

### 1. Export cookies from YouTube

**Option A: Using a Browser Extension (Recommended)**

- Install [EditThisCookie](https://www.editthiscookie.com/) (Chrome/Edge) or [Cookie-Editor](https://github.com/js-netforce/cookie-editor) (Firefox)
- Visit youtube.com while logged in
- Click the extension icon → Export → **Save as Netscape format** to a file (e.g., `youtube-cookies.txt`)

**Option B: Using DevTools**

- Open YouTube in your browser while logged in
- Press F12 → Storage/Application tab → Cookies → youtube.com
- You can manually export or use a script to extract them

### 2. Encode cookies

```bash
npx tsx scripts/encode-cookies.ts <path-to-cookies.txt>
```

This will output:
```
✓ Successfully encoded cookies file.

Add this to your .env.local:

YTDLP_COOKIES_BASE64=<long-base64-string>

Then redeploy the worker:
  cd ai-worker
  .venv/bin/modal deploy analysis.py
```

### 3. Add to .env.local and redeploy

```bash
# Add to .env.local
YTDLP_COOKIES_BASE64=<paste-the-base64-string>

# Redeploy worker
cd ai-worker
.venv/bin/modal deploy analysis.py
```

## How It Works

- The worker decodes the base64 cookies at runtime
- Writes them to a temporary cookies.txt file
- Passes them to yt-dlp with `--cookies` flag
- Cookies are only used during the download phase and never stored

## Environment Variables

You can provide cookies in one of three ways:

1. **`YTDLP_COOKIES_BASE64`** (recommended)
   - Base64-encoded Netscape cookies content
   - Easy to paste into .env.local
   - Use the `encode-cookies.ts` script

2. **`YTDLP_COOKIES_TXT`**
   - Raw Netscape cookies content as a string
   - Less practical due to line breaks, but supported

3. **`YTDLP_COOKIE_FILE`**
   - Path to a cookies.txt file in the worker container
   - Not practical for Modal, but supported for local testing

## Troubleshooting

**Still getting 422 after adding cookies?**

- Ensure cookies are not expired. Log into YouTube again and re-export.
- Try a different video to confirm the cookie setup works.
- Check that you added the env var to `.env.local` (not `.env`)
- Confirm the worker redeployed successfully: check the Modal logs

**How long do cookies last?**

YouTube session cookies typically last 26+ weeks, but may expire sooner if:
- Your Google account logs out
- Your IP changes significantly
- You change your security settings

Re-export and redeploy if downloads start failing again.
