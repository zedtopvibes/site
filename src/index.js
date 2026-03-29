export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    try {
      const update = await request.json();

      // 1. Handle Messages (Commands & Search)
      if (update.message?.text) {
        const { chat, text } = update.message;
        const chatId = chat.id;

        if (text === "/start") {
          return this.sendMessage(chatId, "🎵 *ZedTopVibes Bot Ready*\n\n• Send a keyword to **search**\n• Use /list to see **all files**", env);
        }

        if (text === "/list") {
          return this.handleList(chatId, env);
        }

        // Treat any other text as a search query
        return this.handleSearch(chatId, text, env);
      }

      // 2. Handle Button Clicks (Callbacks)
      if (update.callback_query) {
        const { id, message, data } = update.callback_query;
        // Format: "dl:filename.mp3"
        if (data.startsWith("dl:")) {
          const fileName = data.split("dl:")[1];
          await this.answerCallback(id, "Fetching file...", env);
          return this.sendR2File(message.chat.id, fileName, env);
        }
      }

      return new Response("OK");
    } catch (err) {
      return new Response(err.stack, { status: 500 });
    }
  },

  // --- FEATURES ---

  async handleList(chatId, env) {
    const list = await env.AUDIO.list({ limit: 10 });
    if (list.objects.length === 0) return this.sendMessage(chatId, "Storage is empty.", env);

    const buttons = list.objects.map(obj => ([{
      text: `📥 ${obj.key}`,
      callback_data: `dl:${obj.key}`
    }]));

    return this.sendMessage(chatId, "📂 *Latest Uploads:*", env, { inline_keyboard: buttons });
  },

  async handleSearch(chatId, query, env) {
    // R2 list allows prefixing; for a "true" search without a DB, we list and filter
    const list = await env.AUDIO.list(); 
    const matches = list.objects.filter(obj => 
      obj.key.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8); // Limit to 8 results for the UI

    if (matches.length === 0) {
      return this.sendMessage(chatId, `❌ No results for "${query}"`, env);
    }

    const buttons = matches.map(obj => ([{
      text: `🎵 ${obj.key}`,
      callback_data: `dl:${obj.key}`
    }]));

    return this.sendMessage(chatId, `🔍 *Results for "${query}":*`, env, { inline_keyboard: buttons });
  },

  async sendR2File(chatId, fileName, env) {
    const object = await env.AUDIO.get(fileName);
    if (!object) return this.sendMessage(chatId, "File missing.", env);

    await this.sendChatAction(chatId, "upload_voice", env);

    const formData = new FormData();
    formData.append("chat_id", chatId);
    
    // Feature: Clean up the title for the player
    const cleanTitle = fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
    formData.append("title", cleanTitle);
    formData.append("performer", "ZedTopVibes"); 
    
    const blob = await object.blob();
    formData.append("audio", blob, fileName);

    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, {
      method: "POST",
      body: formData,
    });
  },

  // --- HELPERS ---

  async sendMessage(chatId, text, env, replyMarkup = null) {
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown",
        reply_markup: replyMarkup
      }),
    });
  },

  async answerCallback(callbackQueryId, text, env) {
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text }),
    });
  },

  async sendChatAction(chatId, action, env) {
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: action }),
    });
  }
};
