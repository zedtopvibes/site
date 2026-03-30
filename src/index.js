export default {
  // 1. CONFIGURATION
  ADMIN_ID: 5672184873, 
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev", 

  async fetch(request, env) {
    const url = new URL(request.url);

    // --- ROUTE A: WEB DOWNLOAD PAGE ---
    if (url.pathname.startsWith('/download/')) {
      return await this.handleDownloadPage(url, env);
    }

    // --- ROUTE B: DIRECT FILE STREAM ---
    if (url.pathname.startsWith('/file/')) {
      return await this.handleFileStream(url, env);
    }

    // --- ROUTE C: TELEGRAM BOT WEBHOOK ---
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        return await this.handleTelegramUpdate(update, env);
      } catch (e) {
        return new Response("OK");
      }
    }

    return new Response("🚀 ZedTopVibes R2 Engine is Live.");
  },

  /**
   * WEB: Generates a professional download page
   */
  async handleDownloadPage(url, env) {
    const artistRaw = url.pathname.split('/download/')[1];
    if (!artistRaw) return new Response("Artist not found", { status: 404 });
    
    // decodeURIComponent handles %20 (spaces) correctly for the UI
    const artistName = decodeURIComponent(artistRaw).replace(/_/g, ' ');
    const list = await env.AUDIO.list({ prefix: `${decodeURIComponent(artistRaw)}/` });
    
    const encodedUrl = encodeURIComponent(url.href);
    const encodedText = encodeURIComponent(`🔥 Check out the latest music from ${artistName}!`);

    let rows = list.objects.map(obj => {
      const fileName = obj.key.split('/').pop().replace(/_/g, ' ').replace('.mp3', '');
      return `
        <div class="track-card">
          <div class="info">
            <span class="name">${fileName}</span>
            <span class="size">${(obj.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <a href="/file/${encodeURIComponent(obj.key)}" class="dl-btn">Download</a>
        </div>`;
    }).join('');

    return new Response(`<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${artistName} | ZedTopVibes</title>
        <style>
          body { font-family: sans-serif; background: #0f172a; color: white; padding: 20px; }
          .container { max-width: 600px; margin: auto; }
          .share-row { display: flex; gap: 10px; margin-bottom: 20px; }
          .share-btn { flex: 1; text-align: center; padding: 10px; border-radius: 8px; color: white; text-decoration: none; font-weight: bold; font-size: 0.8rem; }
          .track-card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
          .dl-btn { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 15px; border-radius: 8px; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${artistName}</h1>
          <div class="share-row">
            <a href="https://t.me/share/url?url=${encodedUrl}&text=${encodedText}" class="share-btn" style="background:#229ED9">Telegram</a>
            <a href="https://wa.me/?text=${encodedText}%20${encodedUrl}" class="share-btn" style="background:#25D366">WhatsApp</a>
          </div>
          ${rows || '<p>No tracks found.</p>'}
        </div>
      </body>
    </html>`, { headers: { "Content-Type": "text/html" } });
  },

  /**
   * WEB: File Streaming
   */
  async handleFileStream(url, env) {
    const key = decodeURIComponent(url.pathname.replace('/file/', ''));
    const object = await env.AUDIO.get(key);
    if (!object) return new Response("Not Found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Disposition", `attachment; filename="${key.split('/').pop()}"`);
    return new Response(object.body, { headers });
  },

  /**
   * TELEGRAM: Bot Logic
   */
  async handleTelegramUpdate(update, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    if (!msg) return new Response("OK");

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // 1. ADMIN UPLOAD
    if (msg.audio && userId === this.ADMIN_ID) {
      // Clean names: Replace spaces with underscores for storage safety
      const performer = (msg.audio.performer || "Unknown").trim().replace(/\s+/g, '_');
      const title = (msg.audio.title || "Track").trim().replace(/\s+/g, '_');
      const r2Key = `${performer}/${title}.mp3`;

      const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${msg.audio.file_id}`);
      const fileData = await getFile.json();
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
      
      await env.AUDIO.put(r2Key, download.body);

      // FIX: Encode the link for Telegram Markdown
      const safeLink = `${this.BASE_URL}/download/${encodeURIComponent(performer)}`;
      return this.sendText(chatId, token, `✅ *R2 UPLOADED*\n\n👤 Artist: ${performer.replace(/_/g, ' ')}\n🔗 [View Download Page](${safeLink})`);
    }

    // 2. SEARCH
    if (msg.text) {
      const query = msg.text.toLowerCase().trim();
      if (query === '/start') return this.sendText(chatId, token, "Send an Artist name to find their music!");

      const list = await env.AUDIO.list();
      const artists = [...new Set(list.objects.map(o => o.key.split('/')[0]))];
      const match = artists.find(a => a.toLowerCase().includes(query.replace(/\s+/g, '_')));

      if (match) {
        // FIX: Wrap the encoded URL in Markdown so it doesn't break
        const safeLink = `${this.BASE_URL}/download/${encodeURIComponent(match)}`;
        return this.sendText(chatId, token, 
          `🔎 *Found:* ${match.replace(/_/g, ' ')}\n\n🔗 [Open Download Page](${safeLink})`
        );
      }
      return this.sendText(chatId, token, "❌ No artist found in R2.");
    }

    return new Response("OK");
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  }
};
