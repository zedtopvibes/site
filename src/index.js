export default {
  // 1. CONFIGURATION
  ADMIN_ID: 5672184873, 
  BOT_USERNAME: "aitestzmbot", // Your bot's handle without @
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",

  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.TELEGRAM_BOT_TOKEN;

    // --- ROUTE A: WEB DOWNLOAD PAGE ---
    if (url.pathname.startsWith('/download/')) {
      return await this.handleWebPage(url, env);
    }

    // --- ROUTE B: TELEGRAM BOT WEBHOOK ---
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        
        // 1. CHANNEL INDEXING (When you post to your Private Channel)
        if (update.channel_post?.audio) {
          const audio = update.channel_post.audio;
          const title = (audio.title || "Unknown").replace(/'/g, "''");
          const artist = (audio.performer || "Unknown").replace(/'/g, "''");
          
          await env.DB.prepare(
            "INSERT INTO tg_storage (title, artist, telegram_file_id) VALUES (?, ?, ?)"
          ).bind(title, artist, audio.file_id).run();
          return new Response("Indexed");
        }

        const msg = update.message;
        if (!msg) return new Response("OK");
        const chatId = msg.chat.id;

        // 2. DEEP LINK DELIVERY (When user clicks /start dl_ID)
        if (msg.text?.startsWith('/start dl_')) {
          const storageId = msg.text.split('dl_')[1];
          const file = await env.DB.prepare("SELECT * FROM tg_storage WHERE id = ?").bind(storageId).first();

          if (file) {
            return await this.sendAudio(chatId, file.telegram_file_id, token, file.title, file.artist);
          }
        }

        // 3. IN-BOT SEARCH (When user types "Kanina" or "uValo")
        if (msg.text && !msg.text.startsWith('/')) {
          const query = msg.text.trim();
          const results = await env.DB.prepare(
            "SELECT * FROM tg_storage WHERE artist LIKE ? OR title LIKE ? LIMIT 5"
          ).bind(`%${query}%`, `%${query}%`).all();

          if (results.results.length > 0) {
            let text = `🔎 *Search Results for "${query}":*\n\n`;
            results.results.forEach(t => {
              text += `🎵 *${t.title}*\n👤 ${t.artist}\n📥 [/start dl_${t.id}](https://t.me/${this.BOT_USERNAME}?start=dl_${t.id})\n\n`;
            });
            return this.sendText(chatId, token, text);
          } else {
            return this.sendText(chatId, token, `❌ No tracks found for "${query}".`);
          }
        }

      } catch (e) {
        return new Response("OK");
      }
    }

    return new Response("ZedTopVibes Engine Active.");
  },

  /**
   * WEB: Displays tracks and links them to the Bot Inbox
   */
  async handleWebPage(url, env) {
    const artistQuery = decodeURIComponent(url.pathname.split('/download/')[1]);
    const files = await env.DB.prepare(
      "SELECT * FROM tg_storage WHERE artist LIKE ? OR title LIKE ? ORDER BY id DESC"
    ).bind(`%${artistQuery}%`, `%${artistQuery}%`).all();

    const rows = files.results.map(f => `
      <div class="card">
        <div class="info">
          <div class="title">${f.title}</div>
          <div class="artist">${f.artist}</div>
        </div>
        <a href="https://t.me/${this.BOT_USERNAME}?start=dl_${f.id}" class="dl-btn">Get in Telegram</a>
      </div>
    `).join('');

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; background: #0f172a; color: white; padding: 20px; }
            .card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155; }
            .title { font-weight: bold; color: #38bdf8; }
            .artist { font-size: 0.85rem; color: #94a3b8; }
            .dl-btn { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>Download: ${artistQuery}</h2>
          ${rows || '<p>No tracks found.</p>'}
        </body>
      </html>`, { headers: { 'Content-Type': 'text/html' } });
  },

  async sendAudio(chatId, fileId, token, title, artist) {
    return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        audio: fileId, 
        caption: `✅ *${title}* - ${artist}\n🚀 Shared via ZedTopVibes`,
        parse_mode: 'Markdown'
      })
    });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true })
    });
  }
};
