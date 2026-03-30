export default {
  ADMIN_ID: 5672184873,
  // Your Bot's Username (without @) to build the deep link
  BOT_USERNAME: "aitestzmbot", 

  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.TELEGRAM_BOT_TOKEN;

    // --- ROUTE A: WEB DOWNLOAD PAGE ---
    // Usage: https://your-worker.dev/download/ArtistName
    if (url.pathname.startsWith('/download/')) {
      return await this.handleWebPage(url, env);
    }

    // --- ROUTE B: TELEGRAM BOT WEBHOOK ---
    if (request.method === 'POST') {
      const update = await request.json();

      // 1. AUTO-INDEXING: When you post a song to your PRIVATE CHANNEL
      if (update.channel_post?.audio) {
        const audio = update.channel_post.audio;
        const title = (audio.title || "Unknown Track").replace(/'/g, "''");
        const artist = (audio.performer || "Unknown Artist").replace(/'/g, "''");
        
        await env.DB.prepare(
          "INSERT INTO tg_storage (title, artist, telegram_file_id) VALUES (?, ?, ?)"
        ).bind(title, artist, audio.file_id).run();
        
        return new Response("OK - Indexed to tg_storage");
      }

      // 2. INBOX DELIVERY: When a user clicks the "Get in Telegram" link
      if (update.message?.text?.startsWith('/start dl_')) {
        const storageId = update.message.text.split('dl_')[1];
        
        const file = await env.DB.prepare(
          "SELECT * FROM tg_storage WHERE id = ?"
        ).bind(storageId).first();

        if (file) {
          return await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: update.message.chat.id,
              audio: file.telegram_file_id,
              caption: `🎵 *${file.title}* by ${file.artist}\n\n✅ Delivered by ZedTopVibes`,
              parse_mode: 'Markdown'
            })
          });
        }
      }
    }
    return new Response("OK");
  },

  async handleWebPage(url, env) {
    const artistQuery = decodeURIComponent(url.pathname.split('/download/')[1]);
    
    // Search the dedicated tg_storage table
    const files = await env.DB.prepare(
      "SELECT * FROM tg_storage WHERE artist LIKE ? OR title LIKE ? ORDER BY id DESC"
    ).bind(`%${artistQuery}%`, `%${artistQuery}%`).all();

    const rows = files.results.map(f => `
      <div class="card">
        <div class="info">
          <div class="title">${f.title}</div>
          <div class="artist">${f.artist}</div>
        </div>
        <a href="https://t.me/${this.BOT_USERNAME}?start=dl_${f.id}" class="dl-link">
          Get in Telegram
        </a>
      </div>
    `).join('');

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: -apple-system, sans-serif; background: #0f172a; color: white; padding: 20px; }
            .card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155; }
            .title { font-weight: bold; color: #38bdf8; }
            .artist { font-size: 0.85rem; color: #94a3b8; }
            .dl-link { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 0.9rem; }
          </style>
        </head>
        <body>
          <h2>Download: ${artistQuery}</h2>
          ${rows || '<p>No files found in Telegram Storage.</p>'}
        </body>
      </html>`, { headers: { 'Content-Type': 'text/html' } });
  }
};
