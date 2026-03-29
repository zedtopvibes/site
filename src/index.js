export default {
  ADMIN_ID: 5672184873, // Your ID

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v5: Upload Active');

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;

    // --- 1. ADMIN UPLOAD HANDLER ---
    if (msg?.audio && msg.from.id === this.ADMIN_ID) {
      return this.handleUpload(msg, env);
    }

    // --- 2. CALLBACK HANDLER (Button Clicks) ---
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const fileName = update.callback_query.data;
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: update.callback_query.id, text: "🎶 Sending..." })
      });
      return this.sendR2File(chatId, fileName, env);
    }

    // --- 3. TEXT HANDLER (Search & Commands) ---
    if (msg?.text) {
      const chatId = msg.chat.id;
      const text = msg.text;

      if (text === '/list') {
        const list = await env.AUDIO.list({ limit: 15 });
        return this.showResults(chatId, token, list.objects, "📂 *Bucket Library:*");
      }

      // Search Logic
      const allFiles = await env.AUDIO.list();
      const matches = allFiles.objects.filter(obj => 
        obj.key.toLowerCase().includes(text.toLowerCase())
      ).slice(0, 10);

      if (matches.length > 0) {
        return this.showResults(chatId, token, matches, `🔍 *Results:*`);
      }
      return this.sendText(chatId, token, "No matches. Try /list.");
    }

    return new Response('OK');
  },

  // NEW: Save Telegram Audio to R2
  async handleUpload(message, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const fileId = message.audio.file_id;
    const fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;

    // Get the download link from Telegram
    const getFile = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
    const fileInfo = await getFile.json();
    const filePath = fileInfo.result.file_path;

    // Download the actual file
    const download = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    const arrayBuffer = await download.arrayBuffer();

    // Store in R2
    await env.AUDIO.put(fileName, arrayBuffer);

    return this.sendText(message.chat.id, token, `✅ *Saved to R2:*\n\`${fileName}\``);
  },

  // Helper to show buttons
  async showResults(chatId, token, fileObjects, title) {
    const buttons = fileObjects.map(obj => ([{
      text: `🎵 ${obj.key}`,
      callback_data: obj.key
    }]));
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
    // Setting professional metadata
    formData.append('title', fileName.replace('.mp3', '').replace(/_/g, ' '));
    formData.append('performer', 'ZedTopVibes');
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
