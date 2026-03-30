export default {
  // --- CONFIGURATION ---
  ADMIN_ID: 5672184873, 
  STORAGE_CHANNEL: -1003779504495, 
  BOT_USERNAME: "aitestzmbot",

  async fetch(request, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (request.method !== 'POST') return new Response("ZedTopVibes Engine Live.");

    try {
      const update = await request.json();
      const msg = update.message || update.callback_query?.message;
      if (!msg) return new Response("OK");

      const chatId = msg.chat.id;
      const userId = update.callback_query?.from.id || msg.from.id;
      const isAdmin = userId === this.ADMIN_ID;

      // --- 1. ADMIN BUTTON HANDLER ---
      if (update.callback_query && isAdmin) {
        const data = update.callback_query.data;
        const [action, type, fileId] = data.split(':');

        if (action === 'settype') {
          await env.DB.prepare("INSERT OR REPLACE INTO admin_state (user_id, step, file_id) VALUES (?, ?, ?)")
            .bind(userId, `awaiting_name_${type}`, fileId).run();
          
          const prompt = type === 'single' ? "Enter Artist - Title (e.g. Yo Maps - Pressure)" : "Enter Album Name:";
          return this.sendText(chatId, token, `✍️ ${prompt}`);
        }
      }

      // --- 2. ADMIN TEXT INPUT (Steps) ---
      if (msg.text && isAdmin && !msg.text.startsWith('/')) {
        const state = await env.DB.prepare("SELECT * FROM admin_state WHERE user_id = ?").bind(userId).first();
        
        if (state) {
          if (state.step === 'awaiting_name_single') {
            const parts = msg.text.split('-').map(s => s.trim());
            await this.finishUpload(chatId, token, env, state.file_id, parts[0] || "Unknown", parts[1] || "Track", "Single");
            await env.DB.prepare("DELETE FROM admin_state WHERE user_id = ?").bind(userId).run();
            return new Response("OK");
          }

          if (state.step === 'awaiting_name_album') {
            await env.DB.prepare("UPDATE admin_state SET step = 'awaiting_artist_album', album_name = ? WHERE user_id = ?")
              .bind(msg.text, userId).run();
            return this.sendText(chatId, token, "👤 Enter the Artist Name for this album:");
          }

          if (state.step === 'awaiting_artist_album') {
            await this.finishUpload(chatId, token, env, state.file_id, msg.text, "Album Track", state.album_name);
            await env.DB.prepare("DELETE FROM admin_state WHERE user_id = ?").bind(userId).run();
            return new Response("OK");
          }
        }
      }

      // --- 3. ADMIN FILE UPLOAD ---
      if (msg.audio && isAdmin) {
        return this.sendKeyboard(chatId, token, "🎧 *Audio Received!*\nSave as:", [
          [{ text: "🎵 Single Track", callback_data: `settype:single:${msg.audio.file_id}` }],
          [{ text: "💿 Part of Album", callback_data: `settype:album:${msg.audio.file_id}` }]
        ]);
      }

      // --- 4. PUBLIC SEARCH & DELIVERY ---
      const text = msg.text || "";
      if (text.startsWith('/start dl_')) {
        const track = await env.DB.prepare("SELECT * FROM tg_storage WHERE id = ?").bind(text.split('dl_')[1]).first();
        if (track) return this.sendAudio(chatId, track.telegram_file_id, token, track.title, track.artist);
      }

      if (text.startsWith('/start album_')) {
        const album = decodeURIComponent(text.split('album_')[1]);
        const tracks = await env.DB.prepare("SELECT * FROM tg_storage WHERE album = ?").bind(album).all();
        for (const t of tracks.results) { await this.sendAudio(chatId, t.telegram_file_id, token, t.title, t.artist); }
        return new Response("OK");
      }

      if (text && !text.startsWith('/') && !isAdmin) {
        const results = await env.DB.prepare(
          "SELECT *, COUNT(*) as c FROM tg_storage WHERE artist LIKE ? OR title LIKE ? OR album LIKE ? GROUP BY CASE WHEN album='Single' THEN id ELSE album END LIMIT 5"
        ).bind(`%${text}%`, `%${text}%`, `%${text}%`).all();

        if (results.results.length > 0) {
          let resp = `🔎 *Results:*\n\n`;
          results.results.forEach(r => {
            const isA = r.album !== 'Single';
            const cmd = isA ? `album_${encodeURIComponent(r.album)}` : `dl_${r.id}`;
            resp += `${isA ? '💿' : '🎵'} *${isA ? r.album : r.title}*\n👤 ${r.artist}\n📥 [/start ${cmd}](https://t.me/${this.BOT_USERNAME}?start=${cmd})\n\n`;
          });
          return this.sendText(chatId, token, resp);
        }
      }

    } catch (e) {
      // This part ensures you get an error message if the database fails!
      return this.sendText(this.ADMIN_ID, token, "🚨 Error: " + e.message);
    }
    return new Response("OK");
  },

  async finishUpload(chatId, token, env, fileId, artist, title, album) {
    const fwd = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.STORAGE_CHANNEL, audio: fileId, caption: `✅ ${title} - ${artist} [${album}]` })
    });
    const fwdRes = await fwd.json();
    const newFileId = fwdRes.result.audio.file_id;
    await env.DB.prepare("INSERT INTO tg_storage (title, artist, album, telegram_file_id) VALUES (?, ?, ?, ?)")
      .bind(title, artist, album, newFileId).run();
    return this.sendText(chatId, token, `✅ Successfully Indexed to ${album}.`);
  },

  async sendKeyboard(chatId, token, text, keyboard) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } })
    });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  },

  async sendAudio(chatId, fileId, token, title, artist) {
    return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, audio: fileId, caption: `🎵 ${title} - ${artist}` })
    });
  }
};
