export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v4: Search Active');

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;

    // --- 1. HANDLE BUTTON CLICKS (CALLBACKS) ---
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const fileName = update.callback_query.data;
      
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: update.callback_query.id, text: "🎶 Sending audio..." })
      });

      return this.sendR2File(chatId, fileName, env);
    }

    // --- 2. HANDLE MESSAGES (COMMANDS & SEARCH) ---
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/start') {
        return this.sendText(chatId, token, "Welcome! Send me a song name to search, or use /list.");
      }

      if (text === '/list') {
        const list = await env.AUDIO.list({ limit: 15 });
        return this.showResults(chatId, token, list.objects, "📂 *All Files:*");
      }

      // --- THE SEARCH FEATURE ---
      // We list ALL files in the bucket and filter them by the user's text
      const allFiles = await env.AUDIO.list();
      const matches = allFiles.objects.filter(obj => 
        obj.key.toLowerCase().includes(text.toLowerCase())
      ).slice(0, 10); // Limit to top 10 matches to keep the UI clean

      if (matches.length > 0) {
        return this.showResults(chatId, token, matches, `🔍 *Results for "${text}":*`);
      } else {
        return this.sendText(chatId, token, `❌ No files found matching "${text}".`);
      }
    }

    return new Response('OK');
  },

  // Helper to generate a list of buttons
  async showResults(chatId, token, fileObjects, title) {
    const buttons = fileObjects.map(obj => ([{
      text: `🎵 ${obj.key}`,
      callback_data: obj.key
    }]));

    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: title,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      })
    });
  },

  async sendR2File(chatId, fileName, env) {
    const object = await env.AUDIO.get(fileName);
    if (!object) return;

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), fileName);

    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, {
      method: 'POST',
      body: formData
    });
  },

  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  }
};
