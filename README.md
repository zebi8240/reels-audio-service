# reels-audio-service

Free Instagram Reels / posts / videos / stories **to MP3** microservice.
Built for **reelsaudiodownloader.in** as a free replacement for the paid RapidAPI API.

- **Engine:** yt-dlp (extracts audio) + ffmpeg (converts to MP3)
- **Cost:** $0 — no API credits, no quotas
- **Hosting:** Render free tier (or any Node host)

## How it works

```
WordPress site  --->  GET /api/audio?url=<instagram url>  --->  this service
        ^                        |
        |                        v
        +----- MP3 link (valid 30 min, auto-deleted) ------+
```

1. WordPress plugin calls `/api/audio?url=...`
2. Service downloads the reel with yt-dlp, converts to MP3 with ffmpeg
3. Returns JSON: `{ success: true, audioUrl, downloadUrl }`
4. MP3 files auto-delete after 30 minutes

## Deploy on Render (free)

1. Upload this folder to a new GitHub repo (all files, no need for `node_modules`)
2. Render dashboard → **New +** → **Web Service** → connect the repo
3. Render auto-detects `render.yaml` — just click **Create Web Service**
4. Wait 2–4 minutes for the build. Then open:
   `https://YOUR-SERVICE.onrender.com/` → you should see "reels-audio-service is running"
5. Test with a real reel:
   `https://YOUR-SERVICE.onrender.com/api/audio?url=https://www.instagram.com/reel/XXXX/`
   (first request after sleep takes ~50 sec while Render wakes up)

## Connect to WordPress

In your `irad` plugin (the function hooked to `wp_ajax_irad_get_audio`),
paste this **before** the RapidAPI code (keep RapidAPI as fallback):

```php
// 1) Try the free yt-dlp microservice first
$service_url = 'https://YOUR-SERVICE.onrender.com/api/audio?url=' . urlencode($reel_url);
$svc = wp_remote_get($service_url, array('timeout' => 120));
if (!is_wp_error($svc) && wp_remote_retrieve_response_code($svc) === 200) {
    $sbody = json_decode(wp_remote_retrieve_body($svc), true);
    if (!empty($sbody['success']) && !empty($sbody['audioUrl'])) {
        wp_send_json_success(array(
            'audioUrl'    => esc_url_raw($sbody['audioUrl']),
            'downloadUrl' => esc_url_raw($sbody['downloadUrl']),
            'title'       => '',
            'author'      => '',
            'songName'    => '',
            'artistName'  => '',
        ));
    }
}
// 2) Fallback: your existing RapidAPI code continues below...
```

Replace `YOUR-SERVICE` with your real Render service name.

## Notes

- Keep the service awake with UptimeRobot (ping `/` every 5 min) — same trick as the snack downloader
- yt-dlp auto-updates on every server start (`-U`), so Instagram changes don't break it for long
- MP3 links expire after 30 minutes; files are deleted automatically
- Simple rate limit built in: 30 requests/minute per IP
