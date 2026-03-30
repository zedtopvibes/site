export default {
  // CONFIGURATION
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",
  ADMIN_ID: 5672184873, 

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const { pathname } = new URL(request.url);

    // --- 1. THE PRO DOWNLOAD PAGE (Browser GET Request) ---
    if (pathname.startsWith("/download/")) {
      const id = pathname.split("/")[2];
      try {
        const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
        
        if (!song) {
          return new Response("<h1>404: Music Not Found</h1>", { status: 404, headers: { "Content-Type": "text/html" } });
        }

        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${song.title} | ZedTopVibes</title>
    <style>
        :root { --primary: #0088cc; --accent: #00d2ff; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, system-ui, sans-serif; 
            background: #0f0f10; color: white; 
            display: flex; align-items: center; justify-content: center; 
            min-height: 100vh; overflow: hidden;
        }
        .bg {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: radial-gradient(circle at top right, #001f3f, #000);
            z-index: -1;
        }
        .container {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            padding: 40px; border-radius: 35px;
            text-align: center; max-width: 380px; width: 90%;
            box-shadow: 0 25px 50px rgba(0,0,0,0.5);
        }
        .record {
            width: 140px; height: 140px;
            background: linear-gradient(135deg, var(--primary), var(--accent));
            border-radius: 50%; margin: 0 auto 25px;
            display: flex; align-items: center; justify-content: center;
            font-size: 50px;
            box-shadow: 0 0 30px rgba(0, 136, 204, 0.4);
            animation: rotate 6s linear infinite;
        }
        @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        h1 { font-size: 24px; margin-bottom: 8px; font-weight: 800; }
        p.artist { color: #aaa; font-size: 18px; margin-bottom: 35px; }
        
        .download-btn {
            background: var(--primary);
            color: white; padding: 18px 45px;
            text-decoration: none; border-radius: 50px;
            font-weight: bold; display: inline-block;
            transition: 0.3s;
            box-shadow: 0 10px 20px rgba(0, 136, 204, 0.3);
            animation: pulse 2s infinite;
        }
        .download-btn:hover { transform: scale(1.05); background: #00aaff; }
        
        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0, 136, 204, 0.7); }
            70% { box-shadow: 0 0 0 15px rgba(0, 136, 204, 0); }
            100% { box-shadow: 0 0 0 0 rgba(0, 136, 204, 0); }
        }
        .footer { margin-top: 40px; font-size: 11px; opacity: 0.3; letter-spacing: 1px; }
    </style>
</head>
<body>
    <div class="bg"></div>
    <div class="container">
        <div class="record">🎵</div>
        <h1>${song.title}</h1>
        <p class="artist">${song.artist}</p>
        <a href="https://t.me/aitestzmbot?start=dl_${id}" class="download-btn">📥 GET ON TELEGRAM</a>
        <div class="footer">ZEDTOPVIBES CLOUD ENGINE</div>
    </div>
</body>
</html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      } catch (e) {
        return new Response("Database Error", { status: 500 });
      }
    }

    // --- 2. THE TELEGRAM BOT LOGIC (POST Webhook Request) ---
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        const msg = update.message;
        if (!msg) return new Response("OK");

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text || "";

        // A. ADMIN UPLOAD: Save MP3 & Generate Link
        if (msg.audio && userId === this.ADMIN_ID) {
          const title = (msg.audio.title || "Unknown Track").replace(/'/g, "''");
          const artist = (msg.audio.performer || "Unknown Artist").replace(/'/g, "''");
          const fileId = msg.audio.file_id;

          const result = await env.DB.prepare(
            "INSERT INTO music_library (title, artist, telegram_file_id) VALUES (?, ?, ?) RETURNING id"
          ).bind(title, artist, fileId).first();

          if (result && result.id) {
            return this.sendText(chatId, token, 
              `🔥 *ZEDTOPVIBES INDEXER*\n\n` +
              `✅ *Successfully Saved*\n` +
              `🎵 *Track:* ${title}\n` +
              `👤 *Artist:* ${artist}\n\n` +
              `🔗 *Live Link:* ${this.BASE_URL}/download/${result.id}`
            );
          }
        }

        // B. FILE DELIVERY: Triggers when user clicks "Get on Telegram"
        if (text.startsWith("/start dl_")) {
          const id = text.split("dl_")[1];
          const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
          if (song) {
            return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                audio: song.telegram_file_id,
                caption: `🎵 ${song.title} - ${song.artist}\n\n⚡️ Delivered by ZedTopVibes`
              })
            });
          }
        }

        // C. SEARCH: Find songs and show buttons
        if (text && !text.startsWith("/")) {
          const { results } = await env.DB.prepare(
            "SELECT * FROM music_library WHERE title LIKE ? OR artist LIKE ? LIMIT 5"
          ).bind(`%${text}%`, `%${text}%`).all();

          if (results.length > 0) {
            let resp = "🔎 *Results for:* _" + text + "_\n\n";
            results.forEach(s => {
              resp += `🎵 *${s.title}* - ${s.artist}\n🔗 [Download Page](${this.BASE_URL}/download/${s.id})\n\n`;
            });
            return this.sendText(chatId, token, resp);
          } else {
            return this.sendText(chatId, token, "❌ No songs found matching that search.");
          }
        }

      } catch (e) {
        return this.sendText(this.ADMIN_ID, token, "🚨 Error: " + e.message);
      }
    }

    // --- 3. FALLBACK: Main URL Visit ---
    return new Response("ZedTopVibes Engine: Running.", { status: 200 });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  }
};
