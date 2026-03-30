export default {
  // Your worker URL is now the main base
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",
  ADMIN_ID: 5672184873, 

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const { pathname, searchParams } = new URL(request.url);

    // --- 1. WEB VIEW (The "Download Page" for browsers) ---
    // If someone visits /download/ID in a browser, show a simple page
    if (pathname.startsWith("/download/")) {
      const id = pathname.split("/")[2];
      const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
      
      if (!song) return new Response("Song not found", { status: 404 });

      const html = `
        <html>
          <body style="font-family:sans-serif; text-align:center; padding:50px;">
            <h1>${song.title}</h1>
            <h3>${song.artist}</h3>
            <p>Click below to receive this file in Telegram:</p>
            <a href="https://t.me/aitestzmbot?start=dl_${id}" 
               style="background:#0088cc; color:white; padding:15px 30px; text-decoration:none; border-radius:5px;">
               📥 Send to Telegram
            </a>
          </body>
        </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // --- 2. TELEGRAM WEBHOOK (POST requests from Telegram) ---
    if (request.method === 'POST') {
      const update = await request.json();
      const msg = update.message;
      if (!msg) return new Response("OK");

      const chatId = msg.chat.id;
      const text = msg.text || "";

      // A. Admin Upload
      if (msg.audio && msg.from.id === this.ADMIN_ID) {
        const { success, lastRowId } = await env.DB.prepare(
          "INSERT INTO music_library (title, artist, telegram_file_id) VALUES (?, ?, ?)"
        ).bind(msg.audio.title || "Unknown", msg.audio.performer || "Unknown", msg.audio.file_id).run();

        if (success) {
          return this.sendText(chatId, token, `✅ Saved! Link: ${this.BASE_URL}/download/${lastRowId}`);
        }
      }

      // B. File Delivery (/start dl_ID)
      if (text.startsWith("/start dl_")) {
        const id = text.split("dl_")[1];
        const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
        if (song) {
          return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, audio: song.telegram_file_id, caption: `🎵 ${song.title}` })
          });
        }
      }

      // C. Search
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
      return new Response("OK");
    }

    return new Response("ZedTopVibes Worker is active.");
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  }
};
