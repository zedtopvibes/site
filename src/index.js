export default {
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

    return new Response("🚀 ZedTopVibes Direct R2 Active.");
  },

  /**
   * WEB: The Download Page (Finds files matching the keyword)
   */
  async handleDownloadPage(url, env) {
    const searchRaw = url.pathname.split('/download/')[1];
    if (!searchRaw) return new Response("Search term missing", { status: 404 });
    
    const searchTerm = decodeURIComponent(searchRaw).toLowerCase();
    
    // 1. List ALL files in the bucket
    const list = await env.AUDIO.list();
    
    // 2. Filter: Find any file that contains the search term in its name
    const matches = list.objects.filter(obj => 
      obj.key.toLowerCase().includes(searchTerm)
    );
    
    const encodedUrl = encodeURIComponent(url.href);
    const encodedText = encodeURIComponent(`🔥 Download music on ZedTopVibes!`);

    let rows = matches.map(obj => {
      // Clean up the name for the UI (remove .mp3 and underscores)
      const displayName = obj.key.replace(/_/g, ' ').replace('.mp3', '');
      return `
        <div class="track-card">
          <div class="info">
            <span class="name">${displayName}</span>
            <span class="size">${(obj.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          <a href="/file/${encodeURIComponent(obj.key)}" class="dl-btn">Download</a>
        </div>`;
    }).join('');

    return new Response(`<!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Download ${searchTerm} | ZedTopVibes</title>
        <style>
          body { font-family: sans-serif; background: #0f172a; color: white; padding: 20px; margin: 0; }
          .container { max-width: 600px; margin: auto; }
          h1 { color: #38bdf8; text-transform: capitalize; }
          .track-card { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155; }
          .info { display: flex; flex-direction: column; }
          .name { font-weight: bold; }
          .size { font-size: 0.8rem; color: #94a3b8; }
          .dl-btn { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 15px; border-radius: 8px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${searchTerm.replace(/_/g, ' ')}</h1>
          ${rows || '<div class="track-card">No files found matching that name.</div>'}
        </div>
      </body>
    </html>`, { headers: { "Content-Type": "text/html" } });
  },

  /**
   * WEB: Direct File Stream
   */
  async handleFileStream(url, env) {
    const key = decodeURIComponent(url.pathname.replace('/file/', ''));
    const object = await env.AUDIO.get(key);
    if (!object) return new Response("File Not Found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Disposition", `attachment; filename="${key}"`);
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

    // 1. ADMIN UPLOAD (Saves as a single flat file)
    if (msg.audio && userId === this.ADMIN_ID) {
      const performer = (msg.audio.performer || "Unknown").trim();
      const title = (msg.audio.title || "Track").trim();
      
      // Filename: "Artist - Title.mp3"
      const r2Key = `${performer} - ${title}.mp3`.replace(/\s+/g, ' ');

      const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${msg.audio.file_id}`);
      const fileData = await getFile.json();
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
      
      await env.AUDIO.put(r2Key, download.body);

      // Link to the specific file's search/download page
      const safeLink = `${this.BASE_URL}/download/${encodeURIComponent(performer)}`;
      return this.sendText(chatId, token, `✅ *UPLOADED TO R2*\n\n📄 File: \`${r2Key}\`\n\n🔗 [Download Page](${safeLink})`);
    }

    // 2. SEARCH
    if (msg.text) {
      const query = msg.text.toLowerCase().trim();
      if (query === '/start') return this.sendText(chatId, token, "Send a song or artist name!");

      // List and check if any file name includes the query
      const list = await env.AUDIO.list();
      const match = list.objects.find(o => o.key.toLowerCase().includes(query));

      if (match) {
        // We use the matched part to generate a search link
        const safeLink = `${this.BASE_URL}/download/${encodeURIComponent(query)}`;
        return this.sendText(chatId, token, `🔎 *Results for "${query}":*\n\n🔗 [Open Download Page](${safeLink})`);
      }
      return this.sendText(chatId, token, "❌ No files found in R2.");
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
