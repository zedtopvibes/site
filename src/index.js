export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v2: Delivery Active');

    const update = await request.json();
    const message = update.message;

    if (message?.text) {
      const chatId = message.chat.id;
      const text = message.text;
      const token = env.TELEGRAM_BOT_TOKEN;

      // --- 1. COMMAND: /list ---
      if (text === '/list') {
        const list = await env.AUDIO.list({ limit: 10 });
        const names = list.objects.map(obj => `• ${obj.key}`).join('\n');
        return this.sendText(chatId, token, names || "Bucket is empty.");
      }

      // --- 2. LOGIC: Is this a filename? ---
      const object = await env.AUDIO.get(text);
      if (object) {
        // Show "Sending audio..." in Telegram
        await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, action: 'upload_voice' })
        });

        // Prepare File for Telegram
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('audio', await object.blob(), text);

        return fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
          method: 'POST',
          body: formData
        });
      }

      // --- 3. DEFAULT RESPONSE ---
      return this.sendText(chatId, token, "Send a filename from /list to download it!");
    }

    return new Response('OK');
  },

  // Helper function to keep code clean
  async sendText(chatId, token, text) {
    return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text })
    });
  }
};
