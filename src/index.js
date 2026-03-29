export default {
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v10: D1 Hub Active');
    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;

    // --- 1. CALLBACK HANDLER (The Navigation Engine) ---
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;
      const chatId = cb.message.chat.id;

      // Clicked an Artist -> Show their Albums
      if (data.startsWith('art:')) {
        const artistId = data.split(':')[1];
        const { results } = await env.DB.prepare("SELECT id, title FROM albums WHERE artist_id = ?").bind(artistId).all();
        const buttons = results.map(alb => ([{ text: `💿 ${alb.title}`, callback_data: `alb:${alb.id}` }]));
        return this.editMenu(chatId, cb.message.message_id, token, "Select an Album:", buttons);
      }

      // Clicked an Album -> Show its Tracks
      if (data.startsWith('alb:')) {
        const albumId = data.split(':')[1];
        const { results } = await env.DB.prepare(`
          SELECT t.title, t.r2_key FROM tracks t 
          JOIN album_tracks at ON t.id = at.track_id 
          WHERE at.album_id = ?
        `).bind(albumId).all();
        const buttons = results.map(t => ([{ text: `🎵 ${t.title}`, callback_data: `play:${t.r2_key}` }]));
        return this.editMenu(chatId, cb.message.message_id, token, "Select a Track:", buttons);
      }

      // Clicked a Track -> Send Audio from R2
      if (data.startsWith('play:')) {
        const r2Key = data.split(':')[1];
        await this.answerCb(token, cb.id, "🎶 Loading Audio...");
        return this.sendR2File(chatId, r2Key, env);
      }
    }

    // --- 2. TEXT HANDLER ---
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text.toLowerCase();

      if (text === '/menu') {
        const { results } = await env.DB.prepare("SELECT id, name FROM artists WHERE status != 'deleted' LIMIT 15").all();
        const buttons = results.map(a => ([{ text: `👤 ${a.name}`, callback_data: `art:${a.id}` }]));
        return this.sendMenu(chatId, token, "🌟 *Main Menu*\nBrowse by Artist:", buttons);
      }
      
      // AI Search could now query D1 instead of R2 for faster results!
    }

    return new Response('OK');
  },

  // Helper to send a new menu
  async sendMenu(chatId, token, text, buttons) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
    });
  },

  // Helper to edit existing menu (keeps the chat clean)
  async editMenu(chatId, messageId, token, text, buttons) {
    return fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, reply_markup: { inline_keyboard: buttons } })
    });
  },

  async sendR2File(chatId, r2Key, env) {
    const object = await env.AUDIO.get(r2Key);
    if (!object) return;
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), r2Key);
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: formData });
  },

  async answerCb(token, id, text) {
    return fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text })
    });
  }
};
