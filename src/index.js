export default {
  // Use your specific Worker URL
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",
  ADMIN_ID: 5672184873, 

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const { pathname } = new URL(request.url);

    // --- 1. THE WEB SERVER (Browser Request) ---
    // This creates the "Download Page" when a user clicks a link
    if (pathname.startsWith("/download/")) {
      const id = pathname.split("/")[2];
      const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
      
      if (!song) return new Response("404: Song Not Found", { status: 404 });

      // This is the HTML for your download page
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Download: ${song.title}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body { font-family: sans-serif; text-align: center; padding: 50px; background: #f4f4f9; }
              .card { background: white; padding: 30px; border-radius: 15px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: inline-block; }
              .btn { background: #0088cc; color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; display: inline-block; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1 style="margin:0;">${song.title}</h1>
              <p style="color:#666;">by ${song.artist}</p>
              <hr>
              <p>To get this file, click the button below to open it in Telegram:</p>
              <a href="https://t.me/aitestzmbot?start=dl_${id}" class="btn">📥 GET FILE IN TELEGRAM</a>
            </div>
          </body>
        </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // --- 2. THE TELEGRAM BOT (Webhook Request) ---
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        const msg = update.message;
        if (!msg) return new Response("OK");

        const chatId = msg.chat.id;
        const text = msg.text || "";

        // ADMIN UPLOAD: Save to DB and give Web Link
        if (msg.audio && msg.from.id === this.ADMIN_ID) {
          const { success, lastRowId } = await env.DB.prepare(
            "INSERT INTO music_library (title, artist, telegram_file_id) VALUES (?, ?, ?)"
          ).bind(msg.audio.title || "Unknown", msg.audio.performer || "Unknown", msg.audio.file_id).run();

          if (success) {
            return this.sendText(chatId, token, `✅ *Song Indexed!*\n\nWeb Link: ${this.BASE_URL}/download/${lastRowId}`);
          }
        }

        // FILE DELIVERY: Sent when user hits /start dl_ID
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
                caption: `🎵 ${song.title} - ${song.artist}\n\nThanks for using ZedTopVibes!`
              })
            });
          }
        }

        // SEARCH: Returns the Web Link
        if (text && !text.startsWith("/")) {
          const results = await env.DB.prepare("SELECT * FROM music_library WHERE title LIKE ? OR artist LIKE ? LIMIT 5")
            .bind(`%${text}%`, `%${text}%`).all();

          if (results.results.length > 0) {
            let resp = "🔎 *Results:*\n\n";
            results.results.forEach(s => {
              resp += `🎵 *${s.title}*\n🔗 [Open Download Page](${this.BASE_URL}/download/${s.id})\n\n`;
            });
            return this.sendText(chatId, token, resp);
          }
        }

      } catch (e) {
        return this.sendText(this.ADMIN_ID, token, "🚨 Error: " + e.message);
      }
    }

    return new Response("ZedTopVibes Hybrid Bot: Online.");
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  }
};
