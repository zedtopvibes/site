export default {
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v11: Music Hub Active');
    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;

    // --- 1. CALLBACK HANDLER (The Navigation Engine) ---
    if (update.callback_query) {
      const cb = update.callback_query;
      const [action, id] = cb.data.split(':');
      const chatId = cb.message.chat.id;
      const msgId = cb.message.message_id;

      // Navigate: Artist -> Albums
      if (action === 'art') {
        const { results } = await env.DB.prepare("SELECT id, title FROM albums WHERE artist_id = ? AND status='draft'").bind(id).all(); // Change status to 'public' if ready
        const buttons = results.map(alb => ([{ text: `💿 ${alb.title}`, callback_data: `alb:${alb.id}` }]));
        buttons.push([{ text: "⬅️ Back to Artists", callback_data: "menu:top" }]);
        return this.editMenu(chatId, msgId, token, "📂 *Select an Album/EP:*", buttons);
      }

      // Navigate: Album -> Tracks
      if (action === 'alb') {
        const { results } = await env.DB.prepare(`
          SELECT t.title, t.r2_key FROM tracks t 
          JOIN album_tracks at ON t.id = at.track_id 
          WHERE at.album_id = ?
        `).bind(id).all();
        const buttons = results.map(t => ([{ text: `🎵 ${t.title}`, callback_data: `play:${t.r2_key}` }]));
        buttons.push([{ text: "⬅️ Back to Albums", callback_data: "menu:top" }]); // Simplification
        return this.editMenu(chatId, msgId, token, "🎶 *Select a Track:*", buttons);
      }

      // Back to Main Menu
      if (action === 'menu') {
        return this.sendMainMenu(chatId, token, true, msgId, env);
      }

      // Final Step: Play from R2
      if (action === 'play') {
        await this.answerCb(token, cb.id, "🎶 Loading from R2...");
        return this.sendR2File(chatId, id, env); // 'id' here is the r2_key
      }
    }

    // --- 2. TEXT HANDLER (AI Search) ---
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/start' || text === '/menu') {
        return this.sendMainMenu(chatId, token, false, null, env);
      }

      // SMART SEARCH: AI decides what to query
      await this.sendChatAction(chatId, token, 'typing');
      const searchData = await this.getSmartSearch(text, env);
      
      // Query D1 based on AI's extraction
      const { results } = await env.DB.prepare(
        "SELECT id, title as name, 'track' as type FROM tracks WHERE title LIKE ? LIMIT 5"
      ).bind(`%${searchData.query}%`).all();

      if (results.length > 0) {
        const buttons = results.map(r => ([{ text: `🎵 ${r.name}`, callback_data: `play:${r.id}` }]));
        return this.sendMenu(chatId, token, `🔎 *Search Results for "${searchData.query}":*`, buttons);
      }
      return this.sendText(chatId, token, "❌ No matches found in the library.");
    }

    return new Response('OK');
  },

  // --- HELPERS ---

  async sendMainMenu(chatId, token, isEdit, msgId, env) {
    const { results } = await env.DB.prepare("SELECT id, name FROM artists LIMIT 10").all();
    const buttons = results.map(a => ([{ text: `👤 ${a.name}`, callback_data: `art:${a.id}` }]));
    const text = "🌟 *ZedTopVibes Hub*\nChoose an artist to explore their music:";
    return isEdit 
      ? this.editMenu(chatId, msgId, token, text, buttons)
      : this.sendMenu(chatId, token, text, buttons);
  },

  async getSmartSearch(input, env) {
    const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'system', content: 'Extract music keywords only. One or two words.' }, { role: 'user', content: input }]
    });
    return { query: response.response.trim() };
  },

  async sendR2File(chatId, r2Key, env) {
    const object = await env.AUDIO.get(r2Key);
    if (!object) return;
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), r2Key);
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: formData });
  },

  async sendMenu(chatId, token, text, buttons) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
    });
  },

  async editMenu(chatId, msgId, token, text, buttons) {
    return fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
    });
  },

  async sendChatAction(chatId, token, action) {
    return fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action })
    });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  },

  async answerCb(token, id, text) {
    return fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text })
    });
  }
};
