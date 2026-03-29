export default {
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v6: Delete Active');

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    const cb = update.callback_query;

    // --- 1. ADMIN UPLOAD ---
    if (msg?.audio && msg.from.id === this.ADMIN_ID) {
      return this.handleUpload(msg, env);
    }

    // --- 2. CALLBACK HANDLER (Download OR Delete) ---
    if (cb) {
      const chatId = cb.message.chat.id;
      const data = cb.data;
      const userId = cb.from.id;

      // Handle Delete Action
      if (data.startsWith('del:') && userId === this.ADMIN_ID) {
        const fileName = data.replace('del:', '');
        await env.AUDIO.delete(fileName);
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callback_query_id: cb.id, text: "🗑️ Deleted from R2" })
        });
        return this.sendText(chatId, token, `✅ Removed: \`${fileName}\``);
      }

      // Handle Download Action
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cb.id, text: "🎶 Fetching..." })
      });
      return this.sendR2File(chatId, data, env);
    }

    // --- 3. TEXT HANDLER ---
    if (msg?.text) {
      const chatId = msg.chat.id;
      const text = msg.text;
      const userId = msg.from.id;

      if (text === '/list') {
        const list = await env.AUDIO.list({ limit: 15 });
        return this.showResults(chatId, token, list.objects, "📂 *Bucket Library:*", userId);
      }

      const allFiles = await env.AUDIO.list();
      const matches = allFiles.objects.filter(obj => obj.key.toLowerCase().includes(text.toLowerCase())).slice(0, 10);
      if (matches.length > 0) return this.showResults(chatId, token, matches, `🔍 *Results:*`, userId);
      
      return this.sendText(chatId, token, "No matches found.");
    }

    return new Response('OK');
  },

  // Helper to show buttons (Now with Delete for Admin)
  async showResults(chatId, token, fileObjects, title, userId) {
    const buttons = fileObjects.map(obj => {
      let row = [{ text: `🎵 ${obj.key}`, callback_data: obj.key }];
      // Add a delete button only for you!
      if (userId === this.ADMIN_ID) {
        row.push({ text: "🗑️", callback_data: `del:${obj.key}` });
      }
      return row;
    });

    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: title, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
    });
  },

  async handleUpload(message, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const fileId = message.audio.file_id;
    const fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;
    const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const fileInfo = await getFile.json();
    const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`);
    await env.AUDIO.put(fileName, await download.arrayBuffer());
    return this.sendText(message.chat.id, token, `✅ *Saved to R2:*\n\`${fileName}\``);
  },

  async sendR2File(chatId, fileName, env) {
    const object = await env.AUDIO.get(fileName);
    if (!object) return;
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), fileName);
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: formData });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  }
};
