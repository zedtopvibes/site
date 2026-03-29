export default {
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v7: AI Active');

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    const cb = update.callback_query;

    // --- 1. ADMIN UPLOAD ---
    if (msg?.audio && msg.from.id === this.ADMIN_ID) {
      return this.handleUpload(msg, env);
    }

    // --- 2. CALLBACK HANDLER (Download / Delete) ---
    if (cb) {
      const chatId = cb.message.chat.id;
      if (cb.data.startsWith('del:') && cb.from.id === this.ADMIN_ID) {
        const fileName = cb.data.replace('del:', '');
        await env.AUDIO.delete(fileName);
        await this.answerCb(token, cb.id, "🗑️ Deleted");
        return this.sendText(chatId, token, `✅ Removed: \`${fileName}\``);
      }
      await this.answerCb(token, cb.id, "🎶 Fetching...");
      return this.sendR2File(chatId, cb.data, env);
    }

    // --- 3. TEXT HANDLER (AI Search) ---
    if (msg?.text) {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (text === '/start') return this.sendText(chatId, token, "🎵 *ZedTopVibes AI*\nSearch for any song or artist!");
      if (text === '/list') {
        const list = await env.AUDIO.list({ limit: 15 });
        return this.showResults(chatId, token, list.objects, "📂 *Bucket Library:*", msg.from.id);
      }

      // --- NEW: AI QUERY CLEANING ---
      // Tell the user the AI is thinking
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' })
      });

      const cleanQuery = await this.getAiSearchTerm(text, env);
      
      const allFiles = await env.AUDIO.list();
      const matches = allFiles.objects.filter(obj => 
        obj.key.toLowerCase().includes(cleanQuery.toLowerCase())
      ).slice(0, 10);

      if (matches.length > 0) {
        return this.showResults(chatId, token, matches, `🔍 *AI Search Results for:* "${cleanQuery}"`, msg.from.id);
      }
      return this.sendText(chatId, token, `❌ No files found for "${cleanQuery}".`);
    }

    return new Response('OK');
  },

  // AI Function: Uses Llama 3.1 8B (Free Tier friendly)
  async getAiSearchTerm(userInput, env) {
    try {
      const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a music search assistant. Extract ONLY the song name or artist from the user query. Do not include chat or polite words. Output only the keywords.' },
          { role: 'user', content: userInput }
        ]
      });
      return response.response.trim();
    } catch (e) {
      return userInput; // Fallback to raw text if AI fails
    }
  },

  async handleUpload(message, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const fileId = message.audio.file_id;
    const fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;
    const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const fileInfo = await getFile.json();
    const download = await fetch(`https://api.telegram.org/file/bot${token}/${fileInfo.result.file_path}`);
    await env.AUDIO.put(fileName, await download.arrayBuffer());
    return this.sendText(message.chat.id, token, `✅ *Saved to R2:* \`${fileName}\``);
  },

  async showResults(chatId, token, fileObjects, title, userId) {
    const buttons = fileObjects.map(obj => {
      let row = [{ text: `🎵 ${obj.key}`, callback_data: obj.key }];
      if (userId === this.ADMIN_ID) row.push({ text: "🗑️", callback_data: `del:${obj.key}` });
      return row;
    });
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: title, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
    });
  },

  async sendR2File(chatId, fileName, env) {
    const object = await env.AUDIO.get(fileName);
    if (!object) return;
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), fileName);
    formData.append('performer', 'ZedTopVibes');
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, { method: 'POST', body: formData });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });
  },

  async answerCb(token, id, text) {
    return fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: id, text: text })
    });
  }
};
