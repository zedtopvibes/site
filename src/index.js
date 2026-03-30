export default {
  // CONFIGURATION
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",
  ADMIN_ID: 5672184873, 

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const { pathname } = new URL(request.url);

    // --- 1. THE WEB SERVER (Browser Request) ---
    // This creates the "Download Page" when a user clicks a link from search or admin
    if (pathname.startsWith("/download/")) {
      const id = pathname.split("/")[2];
      try {
        const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
        
        if (!song) return new Response("<h1>404: Song Not Found</h1>", { status: 404, headers: { "Content-Type": "text/html" } });

        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>ZedTopVibes - ${song.title}</title>
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 40px 20px; background: #f0f2f5; color: #1c1e21; }
                .card { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); display: inline-block; max-width: 400px; width: 100%; }
                h1 { margin-bottom: 10px; font-size: 24px; color: #000; }
                p.artist { color: #65676b; margin-bottom: 30px; font-size: 18px; }
                .btn { background: #0088cc; color: white; padding: 18px 35px; text-decoration: none; border-radius: 50px; font-weight: bold; display: inline-block; transition: transform 0.2s; }
                .btn:active { transform: scale(0.95); }
                .footer { margin-top: 30px; font-size: 12px; color: #999; }
              </style>
            </head>
            <body>
              <div class="card">
                <h1>${song.title}</h1>
                <p class="artist">by ${song.artist}</p>
                <a href="https://t.me/aitestzmbot?start=dl_${id}" class="btn">📥 GET FILE IN TELEGRAM</a>
                <div class="footer">Powered by ZedTopVibes Engine</div>
              </div>
            </body>
          </html>`;
        return new Response(html, { headers: { "Content-Type": "text/html" } });
      } catch (e) {
        return new Response("Database Error", { status: 500 });
      }
    }

    // --- 2. THE TELEGRAM BOT (Webhook Request) ---
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        const msg = update.message;
        if (!msg) return new Response("OK");

        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = msg.text || "";

        // A. ADMIN UPLOAD (Automatic Save)
        if (msg.audio && userId === this.ADMIN_ID) {
          const title = (msg.audio.title || "Unknown Track").replace(/'/g, "''");
          const artist = (msg.audio.performer || "Unknown Artist").replace(/'/g, "''");
          const fileId = msg.audio.file_id;

          // Crucial Fix: Using RETURNING id to avoid 'undefined'
          const result = await env.DB.prepare(
            "INSERT INTO music_library (title, artist, telegram_file_id) VALUES (?, ?, ?) RETURNING id"
          ).bind(title, artist, fileId).first();

          if (result && result.id) {
            return this.sendText(chatId, token, 
              `✅ *Song Automatically Indexed!*\n\n` +
              `🎵 *${title}* - ${artist}\n` +
              `🆔 *ID:* ${result.id}\n\n` +
              `🔗 *Download Page:* ${this.BASE_URL}/download/${result.id}`
            );
          }
        }

        // B. FILE INBOX DELIVERY (/start dl_ID)
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
                caption: `🎵 ${song.title} - ${song.artist}\n\nDownloaded via ZedTopVibes`
              })
            });
          }
        }

        // C. SEARCH (Returns Web Link)
        if (text && !text.startsWith("/")) {
          const results = await env.DB.prepare(
            "SELECT * FROM music_library WHERE title LIKE ? OR artist LIKE ? LIMIT 5"
          ).bind(`%${text}%`, `%${text}%`).all();

          if (results.results.length > 0) {
            let resp = "🔎 *Search Results:*\n\n";
            results.results.forEach(s => {
              resp += `🎵 *${s.title}* - ${s.artist}\n🔗 [View Download Page](${this.BASE_URL}/download/${s.id})\n\n`;
            });
            return this.sendText(chatId, token, resp);
          } else {
            return this.sendText(chatId, token, "❌ No songs found. Try another search.");
          }
        }

      } catch (e) {
        return this.sendText(this.ADMIN_ID, token, "🚨 Error: " + e.message);
      }
    }

    // --- 3. HOME PAGE (Visit the bare URL) ---
    return new Response("ZedTopVibes Bot is Online. Use Telegram to interact.", { status: 200 });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  }
};
