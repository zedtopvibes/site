export default {
  // --- CONFIGURATION ---
  ADMIN_ID: 5672184873, 
  STORAGE_CHANNEL: -1003779504495, 
  BOT_USERNAME: "aitestzmbot",

  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response("ZedTopVibes Admin Engine Active.");
    }

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message || update.callback_query?.message;
    if (!msg) return new Response("OK");

    const chatId = msg.chat.id;
    const userId = update.callback_query?.from.id || msg.from.id;
    const isAdmin = userId === this.ADMIN_ID;

    // --- 1. CALLBACK QUERY HANDLER (Buttons) ---
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

    // --- 2. ADMIN TEXT INPUT (Processing Steps) ---
    if (msg.text && isAdmin && !msg.text.startsWith('/')) {
      const state = await env.DB.prepare("SELECT * FROM admin_state WHERE user_id = ?").bind(userId).first();
      
      if (state) {
        // Handling Single Upload
        if (state.step === 'awaiting_name_single') {
          const parts = msg.text.split('-').map(s => s.trim());
          const artist = parts[0] || "Unknown Artist";
          const title = parts[1] || "Unknown Track";
          
          await this.finishUpload(chatId, token, env, state.file_id, artist, title, "Single");
          await env.DB.prepare("DELETE FROM admin_state WHERE user_id = ?").bind(userId).run();
          return new Response("OK");
        }

        // Handling Album Step 1: Album Name
        if (state.step === 'awaiting_name_album') {
          await env.DB.prepare("UPDATE admin_state SET step = 'awaiting_artist_album', album_name = ? WHERE user_id = ?")
            .bind(msg.text, userId).run();
          return this.sendText(chatId, token, "👤 Now enter the Artist Name for this album:");
        }

        // Handling Album Step 2: Artist Name
        if (state.step === 'awaiting_artist_album') {
          await this.finishUpload(chatId, token, env, state.file_id, msg.text, "Album Track", state.album_name);
          await env.DB.prepare("DELETE FROM admin_state WHERE user_id = ?").bind(userId).run();
          return new Response("OK");
        }
      }
    }

    // --- 3. FILE UPLOAD INITIATION (Admin Only) ---
    if (msg.audio && isAdmin) {
      return this.sendKeyboard(chatId, token, "🎧 *Audio Received!*\nHow should we save this?", [
        [{ text: "🎵 Save as Single", callback_data: `settype:single:${msg.audio.file_id}` }],
        [{ text: "💿 Add to Album", callback_data: `settype:album:${msg.audio.file_id}` }]
      ]);
    }

    // --- 4. PUBLIC SEARCH & DELIVERY ---
    const text = msg.text || "";
    if (text.startsWith('/start dl_')) {
      const id = text.split('dl_')[1];
      const track = await env.DB.prepare("SELECT * FROM tg_storage WHERE id = ?").bind(id).first();
      if (track) return this.sendAudio(chatId, track.telegram_file_id, token, track.title, track.artist);
    }

    if (text.startsWith('/start album_')) {
      const album = decodeURIComponent(text.split('album_')[1]);
      const tracks = await env.DB.prepare("SELECT * FROM tg_storage WHERE album = ?").bind(album).all();
      for (const t of tracks.results) {
        await this.sendAudio(chatId, t.telegram_file_id, token, t.title, t.artist);
      }
      return new Response("OK");
    }

    // Basic Search Logic
    if (text && !text.startsWith('/') && !isAdmin) {
      const results = await env.DB.prepare(
        "SELECT *, COUNT(*) as count FROM tg_storage WHERE artist LIKE ? OR title LIKE ? OR album LIKE ? GROUP BY CASE WHEN album='Single' THEN id ELSE album END LIMIT 5"
      ).bind(`%${text}%`, `%${text}%`, `%${text}%`).all();

      if (results.results.length > 0) {
        let resp = `🔎 *Search Results:*\n\n`;
        results.results.forEach(r => {
          const isAlb = r.album !== 'Single';
          const cmd = isAlb ? `album_${encodeURIComponent(r.album)}` : `dl_${r.id}`;
          resp += `${isAlb ? '💿' : '🎵'} *${isAlb ? r.album : r.title}*\n👤 ${r.artist}\n📥 [/start ${cmd}](https://t.me/${this.BOT_USERNAME}?start=${cmd})\n\n`;
        });
        return this.sendText(chatId, token, resp);
      }
    }

    return new Response("OK");
  },

  async finishUpload(chatId, token, env, fileId, artist, title, album) {
    // 1. Forward to Private Channel
    const fwd = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: this.STORAGE_CHANNEL, 
        audio: fileId, 
        caption: `✅ *Indexed:* ${title} - ${artist}\n📂 *Album:* ${album}` 
      })
    });
    const fwdRes = await fwd.json();

    // 2. Save to D1 (Use the NEW file_id from the channel for persistence)
    const newFileId = fwdRes.result.audio.file_id;
    await env.DB.prepare("INSERT INTO tg_storage (title, artist, album, telegram_file_id) VALUES (?, ?, ?, ?)")
      .bind(title, artist, album, newFileId).run();

    return this.sendText(chatId, token, `✅ *UPLOADED SUCCESSFUL*\n\nYour file is now live in the Private Channel and searchable via the bot.`);
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
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true })
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
