export default {
  // Replace this with your actual Telegram User ID (Get it from @userinfobot)
  ADMIN_ID: 123456789, 

  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    try {
      const update = await request.json();
      const botToken = env.TELEGRAM_BOT_TOKEN;
      const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
      const userId = update.message?.from?.id || update.callback_query?.from?.id;

      // --- 1. ADMIN UPLOAD TO R2 ---
      // If you send an audio file, the bot saves it to R2
      if (update.message?.audio && userId === this.ADMIN_ID) {
        return this.handleUpload(update.message, env);
      }

      // --- 2. CALLBACK HANDLER ---
      if (update.callback_query) {
        const { id, data } = update.callback_query;
        
        if (data.startsWith("dl:")) {
          const fileName = data.split("dl:")[1];
          await this.tg(botToken, "answerCallbackQuery", { callback_query_id: id, text: "⏬ Fetching..." });
          return this.sendR2File(chatId, fileName, env);
        }

        if (data.startsWith("del:") && userId === this.ADMIN_ID) {
          const fileName = data.split("del:")[1];
          await env.AUDIO.delete(fileName);
          return this.tg(botToken, "answerCallbackQuery", { callback_query_id: id, text: "🗑️ Deleted from R2" });
        }
      }

      // --- 3. TEXT COMMANDS & SEARCH ---
      if (update.message?.text) {
        const text = update.message.text;

        if (text === "/start") {
          return this.tg(botToken, "sendMessage", {
            chat_id: chatId,
            text: "🎵 *ZedTopVibes R2*\n\n• Type /list to browse\n• Send a name to search",
            parse_mode: "Markdown"
          });
        }

        if (text === "/list") return this.handleList(chatId, env, userId);
        
        return this.handleSearch(chatId, text, env, userId);
      }

    } catch (err) {
      console.error(err);
    }
    return new Response("OK");
  },

  async handleUpload(message, env) {
    const fileId = message.audio.file_id;
    const fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;

    // 1. Get file path from Telegram
    const getFile = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await getFile.json();
    const filePath = fileData.result.file_path;

    // 2. Download file from Telegram Servers
    const response = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
    const arrayBuffer = await response.arrayBuffer();

    // 3. Save to R2
    await env.AUDIO.put(fileName, arrayBuffer, {
      httpMetadata: { contentType: "audio/mpeg" }
    });

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: message.chat.id,
      text: `✅ Saved to R2: \`${fileName}\``,
      parse_mode: "Markdown"
    });
  },

  async handleList(chatId, env, userId) {
    const list = await env.AUDIO.list({ limit: 20 });
    if (list.objects.length === 0) return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: "Empty bucket." });

    const buttons = list.objects.map(obj => {
      const row = [{ text: `🎵 ${obj.key}`, callback_data: `dl:${obj.key}` }];
      if (userId === this.ADMIN_ID) row.push({ text: "🗑️", callback_data: `del:${obj.key}` });
      return row;
    });

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "📂 *R2 Files:*",
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });
  },

  async handleSearch(chatId, query, env, userId) {
    const list = await env.AUDIO.list();
    const matches = list.objects.filter(obj => obj.key.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

    if (matches.length === 0) return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: "No matches." });

    const buttons = matches.map(obj => {
      const row = [{ text: `📥 ${obj.key}`, callback_data: `dl:${obj.key}` }];
      if (userId === this.ADMIN_ID) row.push({ text: "🗑️", callback_data: `del:${obj.key}` });
      return row;
    });

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: `🔍 Search: *${query}*`,
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });
  },

  async sendR2File(chatId, fileName, env) {
    const object = await env.AUDIO.get(fileName);
    if (!object) return;

    await this.tg(env.TELEGRAM_BOT_TOKEN, "sendChatAction", { chat_id: chatId, action: "upload_voice" });

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("audio", await object.blob(), fileName);
    formData.append("title", fileName.replace(".mp3", ""));
    formData.append("performer", "ZedTopVibes");

    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendAudio`, {
      method: "POST",
      body: formData
    });
  },

  async tg(token, method, payload) {
    return fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
};
