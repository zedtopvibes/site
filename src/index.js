Export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    try {
      const update = await request.json();
      const botToken = env.TELEGRAM_BOT_TOKEN;

      // Handle Message Text (Search & Commands)
      if (update.message?.text) {
        const { chat, text } = update.message;
        const chatId = chat.id;

        if (text === "/start") {
          return this.tg(botToken, "sendMessage", {
            chat_id: chatId,
            text: "🎵 *ZedTopVibes R2 Explorer*\n\n• Type /list to see all files\n• Send any text to **search** the bucket",
            parse_mode: "Markdown"
          });
        }

        if (text === "/list") {
          return this.handleList(chatId, env);
        }

        // Default to Search
        return this.handleSearch(chatId, text, env);
      }

      // Handle Button Clicks (Downloads)
      if (update.callback_query) {
        const { id, message, data } = update.callback_query;
        if (data.startsWith("dl:")) {
          const fileName = data.split("dl:")[1];
          await this.tg(botToken, "answerCallbackQuery", { callback_query_id: id, text: "⏬ Fetching from R2..." });
          return this.sendR2File(message.chat.id, fileName, env);
        }
      }

    } catch (err) {
      console.error(err);
    }
    return new Response("OK");
  },

  // FEATURE: List all files in R2 with buttons
  async handleList(chatId, env) {
    const list = await env.AUDIO.list({ limit: 20 });
    
    if (list.objects.length === 0) {
      return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: "The R2 bucket is currently empty." });
    }

    const buttons = list.objects.map(obj => ([{
      text: `🎵 ${obj.key}`,
      callback_data: `dl:${obj.key}`
    }]));

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "📂 *Available in R2:*",
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });
  },

  // FEATURE: Search R2 keys for a match
  async handleSearch(chatId, query, env) {
    const list = await env.AUDIO.list();
    const matches = list.objects.filter(obj => 
      obj.key.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 10);

    if (matches.length === 0) {
      return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: `❌ No files found for "${query}"`
      });
    }

    const buttons = matches.map(obj => ([{
      text: `📥 Download ${obj.key}`,
      callback_data: `dl:${obj.key}`
    }]));

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: `🔍 *Search results for:* "${query}"`,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });
  },

  // FEATURE: Stream file + Clean Metadata
  async sendR2File(chatId, fileName, env) {
    const object = await env.AUDIO.get(fileName);
    if (!object) return;

    // Show "Sending audio..." in the top bar
    await this.tg(env.TELEGRAM_BOT_TOKEN, "sendChatAction", { chat_id: chatId, action: "upload_voice" });

    const formData = new FormData();
    formData.append("chat_id", chatId);
    
    // Clean up filename for the player (remove .mp3 and underscores)
    const cleanName = fileName.replace(/\.[^/.]+$/, "").replace(/_/g, " ");
    
    const blob = await object.blob();
    formData.append("audio", blob, fileName);
    formData.append("title", cleanName);
    formData.append("performer", "ZedTopVibes");

    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, {
      method: "POST",
      body: formData
    });
  },

  // Universal Telegram API Helper
  async tg(token, method, payload) {
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
};