export default {
  // --- CONFIGURATION ---
  ADMIN_ID: 5672184873, 
  BOT_USERNAME: "aitestzmbot", 
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",

  async fetch(request, env) {
    const url = new URL(request.url);
    const token = env.TELEGRAM_BOT_TOKEN;

    // WEB ROUTE: Download Page
    if (url.pathname.startsWith('/download/')) {
      return await this.handleWebPage(url, env);
    }

    // BOT ROUTE: Webhook
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        
        // 1. AUTO-INDEXING (From Private Channel)
        if (update.channel_post?.audio) {
          const audio = update.channel_post.audio;
          const title = (audio.title || "Unknown").replace(/'/g, "''");
          const artist = (audio.performer || "Unknown").replace(/'/g, "''");
          const album = (audio.album || "Single").replace(/'/g, "''");
          
          await env.DB.prepare(
            "INSERT INTO tg_storage (title, artist, album, telegram_file_id) VALUES (?, ?, ?, ?)"
          ).bind(title, artist, album, audio.file_id).run();
          return new Response("Indexed");
        }

        const msg = update.message;
        if (!msg) return new Response("OK");
        const chatId = msg.chat.id;
        const text = msg.text || "";

        // 2. SINGLE TRACK DELIVERY
        if (text.startsWith('/start dl_')) {
          const trackId = text.split('dl_')[1];
          const track = await env.DB.prepare("SELECT * FROM tg_storage WHERE id = ?").bind(trackId).first();
          if (track) {
            return await this.sendAudio(chatId, track.telegram_file_id, token, track.title, track.artist);
          }
        }

        // 3. FULL ALBUM DELIVERY
        if (text.startsWith('/start album_')) {
          const albumName = decodeURIComponent(text.split('album_')[1]);
          const tracks = await env.DB.prepare(
            "SELECT * FROM tg_storage WHERE album = ? ORDER BY id ASC"
          ).bind(albumName).all();

          if (tracks.results.length > 0) {
            await this.sendText(chatId, token, `💿 *Album:* ${albumName}\n📦 *Tracks:* ${tracks.results.length}\n\n_Sending all files now..._`);
            for (const t of tracks.results) {
              await this.sendAudio(chatId, t.telegram_file_id, token, t.title, t.artist);
            }
            return new Response("OK");
          }
        }

        // 4. IN-BOT SEARCH (Finds Singles & Albums)
        if (text && !text.startsWith('/')) {
          const query = text.trim();
          // Find unique albums or titles matching query
          const results = await env.DB.prepare(
            `SELECT *, COUNT(*) as track_count FROM tg_storage 
             WHERE artist LIKE ? OR title LIKE ? OR album LIKE ? 
             GROUP BY CASE WHEN album = 'Single' THEN id ELSE album END 
             LIMIT 10`
          ).bind(`%${query}%`, `%${query}%`, `%${query}%`).all();

          if (results.results.length > 0) {
            let response = `🔎 *Results for "${query}":*\n\n`;
            results.results.forEach(f => {
              const isAlbum = f.album !== "Single";
              const cmd = isAlbum ? `album_${encodeURIComponent(f.album)}` : `dl_${f.id}`;
              const label = isAlbum ? `💿 Album: ${f.album} (${f.track_count} tracks)` : `🎵 ${f.title}`;
              
              response += `${label}\n👤 ${f.artist}\n📥 [/start ${cmd}](https://t.me/${this.BOT_USERNAME}?start=${cmd})\n\n`;
            });
            return this.sendText(chatId, token, response);
          }
          return this.sendText(chatId, token, "❌ No results found.");
        }

      } catch (e) { return new Response("OK"); }
    }
    return new Response("ZedTopVibes Engine Live.");
  },

  /**
   * WEB: Displays Search Results with Album Grouping
   */
  async handleWebPage(url, env) {
    const query = decodeURIComponent(url.pathname.split('/download/')[1]);
    const list = await env.DB.prepare(
      `SELECT *, COUNT(*) as t_count FROM tg_storage 
       WHERE artist LIKE ? OR album LIKE ? OR title LIKE ?
       GROUP BY CASE WHEN album = 'Single' THEN id ELSE album END`
    ).bind(`%${query}%`, `%${query}%`, `%${query}%`).all();

    const rows = list.results.map(f => {
      const isAlbum = f.album !== "Single";
      const link = `https://t.me/${this.BOT_USERNAME}?start=${isAlbum ? 'album_' + encodeURIComponent(f.album) : 'dl_' + f.id}`;
      return `
        <div class="card">
          <div class="info">
            <div class="title">${isAlbum ? '💿 ' + f.album : f.title}</div>
            <div class="artist">${f.artist} ${isAlbum ? '(' + f.t_count + ' tracks)' : ''}</div>
          </div>
          <a href="${link}" class="btn">${isAlbum ? 'Get Album' : 'Get Song'}</a>
        </div>`;
    }).join('');

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; background: #0f172a; color: white; padding: 20px; }
            .card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; border: 1px solid #334155; }
            .title { font-weight: bold; color: #38bdf8; }
            .artist { font-size: 0.85rem; color: #94a3b8; }
            .btn { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; font-size: 0.85rem; }
          </style>
        </head>
        <body>
          <h2>Results: ${query}</h2>
          ${rows || '<p>No results found.</p>'}
        </body>
      </html>`, { headers: { 'Content-Type': 'text/html' } });
  },

  async sendAudio(chatId, fileId, token, title, artist) {
    return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, audio: fileId, caption: `✅ *${title}* - ${artist}`, parse_mode: 'Markdown' })
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
