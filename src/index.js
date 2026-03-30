export default {
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const { pathname } = new URL(request.url);

    // --- 1. WEB SERVER (No changes here) ---
    if (pathname.startsWith("/download/")) {
      const id = pathname.split("/")[2];
      const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
      if (!song) return new Response("404", { status: 404 });
      const html = `<html><body style="background:#000;color:#fff;text-align:center;font-family:sans-serif;padding-top:100px;"><h1>${song.title}</h1><p>${song.artist}</p><br><a href="https://t.me/aitestzmbot?start=dl_${id}" style="background:#0088cc;color:#fff;padding:20px;border-radius:50px;text-decoration:none;font-weight:bold;">📥 DOWNLOAD IN TELEGRAM</a></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // --- 2. TELEGRAM BOT ---
    if (request.method === 'POST') {
      const update = await request.json();

      // Handle Buttons
      if (update.callback_query) {
        const data = update.callback_query.data;
        if (data.startsWith("list_")) return this.sendLibrary(update.callback_query.message.chat.id, token, env, parseInt(data.split("_")[1]), update.callback_query.message.message_id);
        return new Response("OK");
      }

      const msg = update.message; if (!msg) return new Response("OK");
      const chatId = msg.chat.id;
      const text = msg.text || "";

      // START
      if (text.startsWith("/start") && !text.includes("dl_")) {
        return this.sendText(chatId, token, "👋 *Welcome to ZedTopVibes!*\n\nSend me a song name or artist to search.");
      }

      // DOWNLOAD TRIGGER
      if (text.startsWith("/start dl_")) {
        const id = text.split("dl_")[1];
        const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
        if (song) return fetch(`https://api.telegram.org/bot${token}/sendAudio`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, audio: song.telegram_file_id, caption: `🎵 ${song.title} - ${song.artist}` })});
      }

      // ARTIST VIEW (NEW)
      if (text.startsWith("/artist_")) {
        const artistName = text.split("/artist_")[1].replace(/_/g, " ");
        const { results } = await env.DB.prepare("SELECT * FROM music_library WHERE artist LIKE ? LIMIT 15").bind(`%${artistName}%`).all();
        if (results.length > 0) {
          let r = `👨‍🎤 *More from ${artistName}:*\n\n`;
          const b = results.map(s => ([{ text: `📥 ${s.title}`, url: `${this.BASE_URL}/download/${s.id}` }]));
          return fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text: r, parse_mode: 'Markdown', reply_markup: { inline_keyboard: b } })});
        }
      }

      // ADMIN UPLOAD
      if (msg.audio && msg.from.id === this.ADMIN_ID) {
        const title = (msg.audio.title || "Unknown").replace(/'/g, "''");
        const artist = (msg.audio.performer || "Unknown").replace(/'/g, "''");
        const res = await env.DB.prepare("INSERT INTO music_library (title, artist, telegram_file_id) VALUES (?, ?, ?) RETURNING id").bind(title, artist, msg.audio.file_id).first();
        return this.sendText(chatId, token, `✅ *Saved:* ${title}\n🔗 ${this.BASE_URL}/download/${res.id}`);
      }

      // BROWSE
      if (text === "📚 Browse Library" || text === "/list") return this.sendLibrary(chatId, token, env, 1);

      // SEARCH (UPDATED to include Artist Link)
      if (text && !text.startsWith("/")) {
        const { results } = await env.DB.prepare("SELECT * FROM music_library WHERE title LIKE ? OR artist LIKE ? LIMIT 5").bind(`%${text}%`, `%${text}%`).all();
        if (results.length > 0) {
          let r = "🔎 *Results:*\n\n";
          results.forEach(s => {
            const artistCmd = `/artist_${s.artist.replace(/\s+/g, '_')}`;
            r += `🎵 *${s.title}*\n👤 Artist: ${artistCmd}\n🔗 [Download Page](${this.BASE_URL}/download/${s.id})\n\n`;
          });
          return this.sendText(chatId, token, r);
        }
        return this.sendText(chatId, token, "❌ No results.");
      }
    }
    return new Response("Online");
  },

  // Helper functions (sendLibrary, sendText) remain the same as previous full code...
  async sendLibrary(chatId, token, env, page, editMsgId = null) {
    const limit = 5;
    const offset = (page - 1) * limit;
    const { results } = await env.DB.prepare("SELECT * FROM music_library LIMIT ? OFFSET ?").bind(limit, offset).all();
    const buttons = results.map(s => ([{ text: `📥 ${s.title}`, url: `${this.BASE_URL}/download/${s.id}` }]));
    const nav = [];
    if (page > 1) nav.push({ text: "⬅️ Back", callback_data: `list_${page - 1}` });
    nav.push({ text: "Next ➡️", callback_data: `list_${page + 1}` });
    buttons.push(nav);
    const endpoint = editMsgId ? "editMessageText" : "sendMessage";
    const body = { chat_id: chatId, text: `📚 *Library - Page ${page}*`, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
    if (editMsgId) body.message_id = editMsgId;
    return fetch(`https://api.telegram.org/bot${token}/${endpoint}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
  }
};
