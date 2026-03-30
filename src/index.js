export default {
  // 1. CONFIGURATION
  ADMIN_ID: 5672184873, 
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev", // Update this if your URL changes

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

    return new Response("🚀 ZedTopVibes R2 Engine is Live. Visit /download/[ArtistName]");
  },

  /**
   * WEB: Generates a professional, social-ready download page
   */
  async handleDownloadPage(url, env) {
    const artistRaw = url.pathname.split('/download/')[1];
    if (!artistRaw) return new Response("Artist not found", { status: 404 });
    
    const artistName = artistRaw.replace(/_/g, ' ');
    const list = await env.AUDIO.list({ prefix: `${artistRaw}/` });
    
    // Social Sharing Links
    const encodedUrl = encodeURIComponent(url.href);
    const encodedText = encodeURIComponent(`🔥 Check out the latest music from ${artistName} on ZedTopVibes!`);

    let rows = list.objects.map(obj => {
      const fileName = obj.key.split('/').pop().replace(/_/g, ' ').replace('.mp3', '');
      const fileSize = (obj.size / 1024 / 1024).toFixed(2);
      return `
        <div class="track-card">
          <div class="info">
            <span class="name">${fileName}</span>
            <span class="size">${fileSize} MB</span>
          </div>
          <div class="actions">
             <audio id="player-${obj.httpEtag}" src="/file/${obj.key}" preload="none"></audio>
             <a href="/file/${obj.key}" class="dl-btn">Download</a>
          </div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${artistName} | Music Downloads</title>
        
        <meta property="og:title" content="${artistName} - Free Music Downloads">
        <meta property="og:description" content="Download the latest tracks and albums from ${artistName} on ZedTopVibes. Fast R2 delivery.">
        <meta property="og:image" content="https://img.icons8.com/clouds/200/music.png">
        <meta property="og:type" content="website">
        <meta name="theme-color" content="#0ea5e9">

        <style>
          body { font-family: -apple-system, system-ui, sans-serif; background: #0f172a; color: white; padding: 15px; margin: 0; }
          .container { max-width: 600px; margin: 20px auto; }
          h1 { color: #38bdf8; font-size: 1.8rem; margin-bottom: 5px; }
          .subtitle { color: #94a3b8; margin-bottom: 25px; font-size: 0.9rem; }
          
          /* Share Buttons */
          .share-row { display: flex; gap: 10px; margin-bottom: 25px; }
          .share-btn { flex: 1; text-align: center; padding: 12px; border-radius: 10px; font-size: 0.85rem; text-decoration: none; color: white; font-weight: bold; transition: 0.2s; }
          .tg-bg { background: #229ED9; }
          .wa-bg { background: #25D366; }
          .share-btn:active { transform: scale(0.96); opacity: 0.9; }

          /* Track Cards */
          .track-card { background: #1e293b; padding: 15px; border-radius: 15px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155; }
          .info { display: flex; flex-direction: column; gap: 4px; }
          .name { font-weight: 600; font-size: 1rem; color: #f8fafc; }
          .size { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
          .dl-btn { background: #0ea5e9; color: white; text-decoration: none; padding: 10px 18px; border-radius: 10px; font-weight: bold; font-size: 0.9rem; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${artistName}</h1>
          <div class="subtitle">Powered by ZedTopVibes R2 Storage</div>

          <div class="share-row">
            <a href="https://t.me/share/url?url=${encodedUrl}&text=${encodedText}" class="share-btn tg-bg">Share to Telegram</a>
            <a href="https://wa.me/?text=${encodedText}%20${encodedUrl}" class="share-btn wa-bg">WhatsApp</a>
          </div>

          <div class="list">
            ${rows || '<div class="track-card">No tracks found yet. Check back soon!</div>'}
          </div>
          
          <p style="text-align:center; color:#475569; font-size:0.8rem; margin-top:40px;">&copy; 2026 ZedTopVibes</p>
        </div>
      </body>
    </html>`;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },

  /**
   * WEB: Direct File Stream with Download Headers
   */
  async handleFileStream(url, env) {
    const key = decodeURIComponent(url.pathname.replace('/file/', ''));
    const object = await env.AUDIO.get(key);

    if (!object) return new Response("File not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Forces the download with the correct filename
    const fileName = key.split('/').pop();
    headers.set("Content-Disposition", `attachment; filename="${fileName}"`);

    return new Response(object.body, { headers });
  },

  /**
   * TELEGRAM: Upload logic and bot interaction
   */
  async handleTelegramUpdate(update, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    if (!msg) return new Response("OK");

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // ADMIN ONLY: Audio Upload
    if (msg.audio && userId === this.ADMIN_ID) {
      const performer = (msg.audio.performer || "Unknown_Artist").replace(/\s+/g, '_');
      const title = (msg.audio.title || `track_${Date.now()}`).replace(/\s+/g, '_');
      const r2Key = `${performer}/${title}.mp3`;

      // Fetch from Telegram servers
      const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${msg.audio.file_id}`);
      const fileData = await getFile.json();
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`);
      
      // Put to R2
      await env.AUDIO.put(r2Key, download.body);

      const pageLink = `${this.BASE_URL}/download/${performer}`;
      return this.sendText(chatId, token, `✅ *UPLOADED TO R2*\n\n👤 Artist: \`${performer.replace(/_/g, ' ')}\`\n🎵 Track: \`${title.replace(/_/g, ' ')}\`\n\n🔗 *Your Live Page:* \n${pageLink}`);
    }

    // SEARCH / START
    if (msg.text) {
      const text = msg.text.toLowerCase();
      if (text === '/start') return this.sendText(chatId, token, "Welcome to ZedTopVibes R2. Send an Artist name to get their download page link!");

      // List all folders (prefixes) to find a match
      const list = await env.AUDIO.list();
      const folders = [...new Set(list.objects.map(o => o.key.split('/')[0]))];
      const match = folders.find(f => f.toLowerCase().includes(text.replace(/\s+/g, '_')));

      if (match) {
        return this.sendText(chatId, token, `🔎 Found a page for *${match.replace(/_/g, ' ')}*:\n\n🔗 ${this.BASE_URL}/download/${match}`);
      }
      return this.sendText(chatId, token, "❌ No music found for that artist in R2.");
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
