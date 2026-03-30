export default {
  // 1. CONFIGURATION
  ADMIN_ID: 5672184873, // Your Telegram ID

  async fetch(request, env) {
    const url = new URL(request.url);

    // --- ROUTE A: WEB DOWNLOAD PAGE ---
    // Usage: https://your-worker.dev/download/Artist_Name
    if (url.pathname.startsWith('/download/')) {
      return await this.handleDownloadPage(url, env);
    }

    // --- ROUTE B: DIRECT FILE STREAM ---
    // Usage: Called by the "Download" buttons on the web page
    if (url.pathname.startsWith('/file/')) {
      return await this.handleFileStream(url, env);
    }

    // --- ROUTE C: TELEGRAM BOT WEBHOOK ---
    if (request.method === 'POST') {
      try {
        const update = await request.json();
        return await this.handleTelegramUpdate(update, env);
      } catch (e) {
        return new Response("OK"); // Ignore non-JSON or errors
      }
    }

    return new Response("ZedTopVibes R2 Engine Active. Use /download/ArtistName to browse.");
  },

  /**
   * WEB: Generates a mobile-friendly download page
   */
  async handleDownloadPage(url, env) {
    const artist = url.pathname.split('/download/')[1];
    if (!artist) return new Response("Artist not found", { status: 404 });

    const list = await env.AUDIO.list({ prefix: `${artist}/` });
    
    let rows = list.objects.map(obj => {
      const fileName = obj.key.split('/').pop();
      return `
        <div class="track-card">
          <div class="info">
            <span class="name">${fileName.replace(/_/g, ' ')}</span>
            <span class="size">${(obj.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <a href="/file/${obj.key}" class="dl-btn">Download</a>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${artist} - Downloads</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #0f172a; color: white; padding: 20px; }
          .container { max-width: 600px; margin: auto; }
          h1 { color: #38bdf8; border-bottom: 2px solid #1e293b; padding-bottom: 10px; }
          .track-card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
          .info { display: flex; flex-direction: column; }
          .name { font-weight: bold; font-size: 1.1rem; }
          .size { font-size: 0.8rem; color: #94a3b8; }
          .dl-btn { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; transition: 0.2s; }
          .dl-btn:active { transform: scale(0.95); background: #0284c7; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎵 ${artist.replace(/_/g, ' ')}</h1>
          ${rows || '<p>No tracks found for this artist.</p>'}
        </div>
      </body>
    </html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },

  /**
   * WEB: Streams the file from R2 to the browser
   */
  async handleFileStream(url, env) {
    const key = url.pathname.replace('/file/', '');
    const object = await env.AUDIO.get(key);

    if (!object) return new Response("File not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Force browser to download instead of play
    headers.set("Content-Disposition", `attachment; filename="${key.split('/').pop()}"`);

    return new Response(object.body, { headers });
  },

  /**
   * TELEGRAM: Handles uploads and commands
   */
  async handleTelegramUpdate(update, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    if (!msg) return new Response("OK");

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // 1. ADMIN UPLOAD HANDLER
    if (msg.audio && userId === this.ADMIN_ID) {
      const performer = (msg.audio.performer || "Unknown").replace(/\s+/g, '_');
      const title = (msg.audio.title || `track_${Date.now()}`).replace(/\s+/g, '_');
      const fileName = `${performer}/${title}.mp3`;

      // Grab file from Telegram
      const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${msg.audio.file_id}`);
      const fileData = await getFile.json();
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
      
      // Save to R2
      await env.AUDIO.put(fileName, download.body);

      const downloadUrl = `https://your-worker.dev/download/${performer}`;
      return this.sendText(chatId, token, `✅ *R2 SUCCESS*\n\nStored as: \`${fileName}\`\n\n[View Download Page](${downloadUrl})`);
    }

    // 2. SEARCH HANDLER
    if (msg.text) {
      const query = msg.text.toLowerCase();
      if (query === '/start') return this.sendText(chatId, token, "Send an Artist name to find their download page.");
      
      const list = await env.AUDIO.list();
      const artists = [...new Set(list.objects.map(o => o.key.split('/')[0]))];
      const match = artists.find(a => a.toLowerCase().includes(query));

      if (match) {
        return this.sendText(chatId, token, `🔎 Found files for *${match.replace(/_/g, ' ')}*:\n\n🔗 https://your-worker.dev/download/${match}`);
      }
      return this.sendText(chatId, token, "❌ No artist found in R2 with that name.");
    }

    return new Response("OK");
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: false })
    });
  }
};
