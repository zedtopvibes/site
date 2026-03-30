export default {
  BASE_URL: "https://aitestzmbot.zedtopvibes.workers.dev",
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const { pathname } = new URL(request.url);

    // --- 1. WEB SERVER (Download Page) ---
    if (pathname.startsWith("/download/")) {
      const id = pathname.split("/")[2];
      const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
      if (!song) return new Response("404", { status: 404 });
      
      // Professional Glassmorphism Page
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:rgba(255,255,255,0.1);padding:40px;border-radius:25px;text-align:center;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1)}h1{margin:0}p{color:#888}.btn{display:inline-block;margin-top:20px;padding:15px 30px;background:#0088cc;color:#fff;text-decoration:none;border-radius:50px;font-weight:bold}</style></head><body><div class="card"><h1>${song.title}</h1><p>${song.artist}</p><a href="https://t.me/aitestzmbot?start=dl_${id}" class="btn">📥 OPEN IN TELEGRAM</a></div></body></html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // --- 2. TELEGRAM BOT ---
    if (request.method === 'POST') {
      const update = await request.json();

      // Handle Pagination & Inline Button Clicks
      if (update.callback_query) {
        const cb = update.callback_query;
        const data = cb.data;
        if (data.startsWith("list_")) return this.sendLibrary(cb.message.chat.id, token, env, parseInt(data.split("_")[1]), cb.message.message_id);
        return new Response("OK");
      }

      const msg = update.message; if (!msg) return new Response("OK");
      const chatId = msg.chat.id;
      const text = msg.text || "";

      // START & MENU
      if (text.startsWith("/start") && !text.includes("dl_")) {
        return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🎸 *ZedTopVibes Music Store*\n\nSearch for a song or browse the library.",
            parse_mode: 'Markdown',
            reply_markup: {
              keyboard: [[{ text: "📚 Browse Library" }, { text: "🔍 Search" }]],
              resize_keyboard: true
            }
          })
        });
      }

      // FILE DELIVERY (Hidden trigger from Web Page)
      if (text.startsWith("/start dl_")) {
        const id = text.split("dl_")[1];
        const song = await env.DB.prepare("SELECT * FROM music_library WHERE id = ?").bind(id).first();
        if (song) return fetch(`https://api.telegram.org/bot${token}/sendAudio`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, audio: song.telegram_file_id, caption: `🎵 ${song.title} - ${song.artist}\n⚡ Delivered by @aitestzmbot` })});
      }

      // ARTIST FILTER
      if (text.startsWith("/artist_")) {
        const artistName = text.split("/artist_")[1].replace(/_/g, " ");
        const { results } = await env.DB.prepare("SELECT * FROM music_library WHERE artist LIKE ? LIMIT 10").bind(`%${artistName}%`).all();
        if (results.length > 0) {
          const buttons = results.map(s => ([{ text: `📥 ${s.title}`, url: `${this.BASE_URL}/download/${s.id}` }]));
          return this.sendInline(chatId, token, `👨‍🎤 *All songs by ${artistName}:*`, buttons);
        }
      }

      // SEARCH (New Layout with Action Buttons)
      if (text && !text.startsWith("/") && text !== "📚 Browse Library" && text !== "🔍 Search") {
        const { results } = await env.DB.prepare("SELECT * FROM music_library WHERE title LIKE ? OR artist LIKE ? LIMIT 5").bind(`%${text}%`, `%${text}%`).all();
        
        if (results.length > 0) {
          for (const s of results) {
            const inline_keyboard = [[
              { text: "🚀 Download", url: `${this.BASE_URL}/download/${s.id}` },
              { text: "👨‍🎤 More by Artist", callback_data: `dummy` }, // Placeholder for now
              { text: "View Artist", url: `https://t.me/aitestzmbot?start=artist_${s.artist.replace(/\s+/g, '_')}` }
            ]];
            
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chatId,
                text: `🎵 *${s.title}*\n👤 ${s.artist}`,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
              })
            });
          }
          return new Response("OK");
        }
        return this.sendText(chatId, token, "❌ No songs found.");
      }

      // BROWSE LIBRARY
      if (text === "📚 Browse Library") return this.sendLibrary(chatId, token, env, 1);
    }
    return new Response("OK");
  },

  // HELPERS
  async sendLibrary(chatId, token, env, page, editMsgId = null) {
    const limit = 5;
    const { results } = await env.DB.prepare("SELECT * FROM music_library LIMIT ? OFFSET ?").bind(limit, (page-1)*limit).all();
    const buttons = results.map(s => ([{ text: `🎵 ${s.title} - ${s.artist}`, url: `${this.BASE_URL}/download/${s.id}` }]));
    const nav = [];
    if (page > 1) nav.push({ text: "⬅️", callback_data: `list_${page - 1}` });
    nav.push({ text: "➡️", callback_data: `list_${page + 1}` });
    buttons.push(nav);
    const body = { chat_id: chatId, text: `📂 *Library Page ${page}*`, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } };
    if (editMsgId) body.message_id = editMsgId;
    return fetch(`https://api.telegram.org/bot${token}/${editMsgId ? 'editMessageText' : 'sendMessage'}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) });
  },

  async sendInline(chatId, token, text, buttons) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }) });
  }
};
