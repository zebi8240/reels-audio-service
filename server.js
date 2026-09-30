/**
 * reels-audio-service
 * Free Instagram Reels -> MP3 microservice (yt-dlp + ffmpeg).
 *
 * Endpoints:
 *   GET /api/audio?url=<instagram reel/post/video/story url>
 *     -> { success: true, audioUrl, downloadUrl, title }
 *        audioUrl / downloadUrl are temporary links (expire after 30 min).
 *     -> { success: false, message } on failure
 */

const express = require('express');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP = path.join(__dirname, 'bin', 'yt-dlp');
const FILES_DIR = path.join(__dirname, 'files');
const FILE_TTL_MS = 30 * 60 * 1000; // download links expire after 30 minutes

fs.mkdirSync(FILES_DIR, { recursive: true });

// Serve the converted MP3 files publicly (temporary links)
app.use('/files', express.static(FILES_DIR));

app.get('/', (req, res) => {
  res.send('reels-audio-service is running. Use /api/audio?url=<instagram url>');
});

// ---- simple in-memory rate limit: max 30 requests per minute per IP ----
const hits = {};
setInterval(() => { for (const k in hits) delete hits[k]; }, 60 * 1000);
app.use('/api/', (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  hits[ip] = (hits[ip] || 0) + 1;
  if (hits[ip] > 30) return res.status(429).json({ success: false, message: 'Too many requests. Slow down.' });
  next();
});

// ---- keep yt-dlp fresh: check for updates at startup (non-blocking) ----
function updateYtDlp() {
  if (!fs.existsSync(YTDLP)) {
    console.log('[yt-dlp] binary not found. Run: node scripts/fetch-ytdlp.js');
    return;
  }
  execFile(YTDLP, ['-U'], { timeout: 90000 }, (err, stdout) => {
    const line = (stdout || '').trim().split('\n').pop();
    console.log('[yt-dlp] update check:', err ? String(err.message).slice(0, 120) : line);
  });
}

app.get('/api/audio', (req, res) => {
  const reelUrl = String(req.query.url || '').trim();

  // only allow instagram links (basic safety)
  if (!/^https?:\/\/(www\.)?instagram\.com\//i.test(reelUrl)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid Instagram URL.' });
  }
  if (!fs.existsSync(YTDLP)) {
    return res.status(500).json({ success: false, message: 'Audio engine not installed yet. Try again in a minute.' });
  }

  const id = crypto.randomBytes(8).toString('hex');
  const outTemplate = path.join(FILES_DIR, `${id}.%(ext)s`);

  const args = [
    '-x',                      // extract audio only
    '--audio-format', 'mp3',
    '--audio-quality', '0',    // best quality
    '--ffmpeg-location', ffmpegPath,
    '--no-playlist',
    '-o', outTemplate,
    reelUrl,
  ];

  const child = spawn(YTDLP, args, { timeout: 180000 });
  let errOut = '';
  child.stderr.on('data', (d) => { errOut += d.toString(); });
  child.on('error', (e) => {
    console.error('[yt-dlp] spawn error:', e.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Audio service unavailable. Try again.' });
  });
  child.on('close', (code) => {
    if (res.headersSent) return;
    const files = fs.readdirSync(FILES_DIR).filter((f) => f.startsWith(id) && f.endsWith('.mp3'));
    if (code === 0 && files.length > 0) {
      const file = files[0];
      const fileUrl = `${req.protocol}://${req.get('host')}/files/${file}`;
      // auto-delete the mp3 after 30 minutes
      setTimeout(() => fs.unlink(path.join(FILES_DIR, file), () => {}), FILE_TTL_MS);
      return res.json({ success: true, audioUrl: fileUrl, downloadUrl: fileUrl, title: '' });
    }
    console.error('[yt-dlp] failed, code', code, errOut.slice(-400));
    // cleanup any partial files
    fs.readdirSync(FILES_DIR)
      .filter((f) => f.startsWith(id))
      .forEach((f) => fs.unlink(path.join(FILES_DIR, f), () => {}));
    return res.status(500).json({ success: false, message: 'Could not extract audio from this link.' });
  });
});

// ---- background cleanup: delete mp3s older than 30 minutes (every 10 min) ----
setInterval(() => {
  const now = Date.now();
  fs.readdirSync(FILES_DIR).forEach((f) => {
    const p = path.join(FILES_DIR, f);
    fs.stat(p, (e, st) => {
      if (!e && now - st.mtimeMs > FILE_TTL_MS) fs.unlink(p, () => {});
    });
  });
}, 10 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`reels-audio-service listening on port ${PORT}`);
  updateYtDlp();
});
