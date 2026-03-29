export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v3: Buttons Active');

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;

    // --- 1. HANDLE BUTTON CLICKS ---
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const fileName = update.callback_query.data; // The filename is stored in the button data
      const callbackId = update.callback_query.id;

      // Tell Telegram we received the click (stops the loading spinner on the button)
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackId, text: "Fetching file..." })
      });

      return this.sendR2File(chatId, fileName, env);
    }

    // --- 2. HANDLE TEXT MESSAGES ---
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/list') {
        const list = await env.AUDIO.list({ limit: 10 });
        
        // Map filenames to Telegram Buttons
        const buttons = list.objects.map(obj => ([{
          text: `🎵 ${obj.key}`,
          callback_data: obj.key // This is what gets sent back when clicked
        }]));

        return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "📂 *Select a file to download:*",
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
          })
        });
      }

      // Default Response
      return this.sendText(chatId, token, "Use /list to see files with buttons!");
    }

    return new Response('OK');
  },

  // Helper to fetch from R2 and send as Audio
  async sendR2File(chatId, fileName, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    const object = await env.AUDIO.get(fileName);

    if (!object) {
      return this.sendText(chatId, token, "File not found in R2.");
    }

    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('audio', await object.blob(), fileName);

    return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
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
