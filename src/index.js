export default {
  ADMIN_ID: 5672184873,

  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('v9: Monitoring Active');

    const update = await request.json();
    const token = env.TELEGRAM_BOT_TOKEN;
    const msg = update.message;
    const userId = msg?.from?.id || update.callback_query?.from?.id;

    // --- 1. ADMIN UPLOAD & CALLBACKS (Same as before) ---
    if (msg?.audio && userId === this.ADMIN_ID) return this.handleUpload(msg, env);
    if (update.callback_query) return this.handleCallback(update.callback_query, env);

    // --- 2. TEXT HANDLER ---
    if (msg?.text) {
      const chatId = msg.chat.id;
      const text = msg.text.trim();

      // Commands
      if (text.toLowerCase() === '/start') return this.sendText(chatId, token, "🎵 *ZedTopVibes AI*\nSend a song name to search.");
      if (text.toLowerCase() === '/list') {
        const list = await env.AUDIO.list({ limit: 15 });
        return this.showResults(chatId, token, list.objects, "📂 *Bucket:*", userId);
      }

      // --- AI SEARCH WITH NEURON TRACKING ---
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' })
      });

      // We capture the AI result AND the usage metadata
      const aiData = await this.getAiSearchWithUsage(msg.text, env);
      const cleanQuery = aiData.query;
      
      const allFiles = await env.AUDIO.list();
      const matches = allFiles.objects.filter(obj => 
        obj.key.toLowerCase().includes(cleanQuery.toLowerCase())
      ).slice(0, 10);

      let title = `🔍 *Results for:* "${cleanQuery}"`;
      
      // ADMIN ONLY: Append the Neuron Usage Report
      if (userId === this.ADMIN_ID) {
        title += `\n\n⚡ *Admin Stats:*\nUsed: \`${aiData.neurons}\` Neurons\nModel: \`Llama-3.1-8B\``;
      }

      if (matches.length > 0) {
        return this.showResults(chatId, token, matches, title, userId);
      }
      return this.sendText(chatId, token, `❌ No files for "${cleanQuery}".\n\n${userId === this.ADMIN_ID ? `⚡ _AI used ${aiData.neurons} neurons_` : ''}`);
    }

    return new Response('OK');
  },

  // AI Function that calculates cost
  async getAiSearchWithUsage(userInput, env) {
    try {
      const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'Extract only music keywords (artist/song). No chat.' },
          { role: 'user', content: userInput }
        ]
      });

      // Llama 3.1 8B pricing approx: Input 25.6k / 1M, Output 75.1k / 1M
      // We estimate based on average token lengths for short queries
      const inputTokens = userInput.length / 4; 
      const outputTokens = result.response.length / 4;
      const estimatedNeurons = Math.ceil((inputTokens * 0.025) + (outputTokens * 0.075));

      return {
        query: result.response.trim(),
        neurons: estimatedNeurons || 1 // Minimum 1 neuron
      };
    } catch (e) {
      return { query: userInput, neurons: 0 };
    }
  },

  // (Helper functions handleUpload, showResults, sendR2File, etc. remain the same)
  // ... [Existing helper functions from previous code]
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
  },

  async handleCallback(cb, env) {
    const token = env.TELEGRAM_BOT_TOKEN;
    if (cb.data.startsWith('del:') && cb.from.id === this.ADMIN_ID) {
      await env.AUDIO.delete(cb.data.replace('del:', ''));
      return this.sendText(cb.message.chat.id, token, "✅ Deleted.");
    }
    return this.sendR2File(cb.message.chat.id, cb.data, env);
  }
};
