export default {
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v1: R2 Pure Engine Active');
    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    const userId = msg?.from?.id || update.callback_query?.from?.id;

    // --- 1. ADMIN UPLOAD (Save to R2) ---
    if (msg?.audio && userId === this.ADMIN_ID) {
      const fileId = msg.audio.file_id;
      const title = msg.audio.title || "Unknown_Track";
      const performer = msg.audio.performer || "Unknown_Artist";
      // We save it as "Artist - Title.mp3" for easy searching later
      const fileName = `${performer} - ${title}.mp3`.replace(/[/\\?%*:|"<>]/g, '-');

      const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const fileInfo = await getFile.json();
      const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`);
      
      await env.AUDIO.put(fileName, await download.arrayBuffer(), {
        httpMetadata: { contentType: 'audio/mpeg' }
      });

      return this.sendText(msg.chat.id, token, `✅ *Stored in R2:* \`${fileName}\``);
    }

    // --- 2. SEARCH & LIST (R2 Direct) ---
    if (msg?.text) {
      const chatId = msg.chat.id;
      const query = msg.text.toLowerCase();

      if (query === '/start') return this.sendText(chatId, token, "🎵 *ZedTopVibes R2*\nSend a name to search my storage.");
      
      if (query === '/list') {
        const list = await env.AUDIO.list({ limit: 20 });
        return this.showResults(chatId, token, list.objects, "📂 *Recent Uploads:*", userId);
      }

      // DIRECT SEARCH: List R2 files and filter by name
      const allFiles = await env.AUDIO.list();
      const matches = allFiles.objects.filter(obj => 
        obj.key.toLowerCase().includes(query)
      ).slice(0, 10);

      if (matches.length > 0) {
        return this.showResults(chatId, token, matches, `🔎 *Results for "${query}":*`, userId);
      }
      return this.sendText(chatId, token, "❌ No files match that name.");
    }

    // --- 3. CALLBACKS (Download/Delete) ---
    if (update.callback_query) {
      const cb = update.callback_query;
      if (cb.data.startsWith('del:') && userId === this.ADMIN_ID) {
        const key = cb.data.replace('del:', '');
        await env.AUDIO.delete(key);
        return this.sendText(cb.message.chat.id, token, "🗑️ Deleted from R2.");
      }
      return this.sendR2File(cb.message.chat.id, cb.data, env);
    }

    return new Response('OK');
  },

  // --- HELPERS ---
  async showResults(chatId, token, files, title, userId) {
    const buttons = files.map(f => {
      let row = [{ text: `🎵 ${f.key}`, callback_data: f.key }];
      if (userId === this.ADMIN_ID) row.push({ text: "🗑️", callback_data: `del:${f.key}` });
      return row;
    });
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: title, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
    });
  },

  async sendR2File(chatId, key, env) {
    const object = await env.AUDIO.get(key);
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), key);
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: formData });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
    });
  }
};
