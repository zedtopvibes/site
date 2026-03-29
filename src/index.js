export default {
  // Your Admin ID
  ADMIN_ID: 5672184873, 

  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    try {
      const update = await request.json();
      const botToken = env.TELEGRAM_BOT_TOKEN;
      
      const msg = update.message;
      const cb = update.callback_query;
      const chatId = msg?.chat?.id || cb?.message?.chat?.id;
      const userId = msg?.from?.id || cb?.from?.id;

      if (!chatId) return new Response("OK");

      // --- ADMIN UPLOAD ---
      // Send any audio file to the bot to save it to R2
      if (msg?.audio && userId === this.ADMIN_ID) {
        return this.handleUpload(msg, env);
      }

      // --- CALLBACK ACTIONS ---
      if (cb) {
        const data = cb.data;
        if (data.startsWith("dl:")) {
          const fileName = data.split("dl:")[1];
          await this.tg(botToken, "answerCallbackQuery", { callback_query_id: cb.id, text: "🚀 Fetching..." });
          return this.sendR2File(chatId, fileName, env);
        }

        if (data.startsWith("del:") && userId === this.ADMIN_ID) {
          const fileName = data.split("del:")[1];
          await env.AUDIO.delete(fileName);
          await this.tg(botToken, "answerCallbackQuery", { callback_query_id: cb.id, text: "🗑️ Deleted" });
          return this.tg(botToken, "sendMessage", { chat_id: chatId, text: `✅ File "${fileName}" removed from R2.` });
        }
      }

      // --- TEXT COMMANDS ---
      if (msg?.text) {
        const text = msg.text;
        if (text === "/start") {
          return this.tg(botToken, "sendMessage", {
            chat_id: chatId,
            text: "🎵 *ZedTopVibes R2 Manager*\n\n• Type /list to see all files\n• Send a song name to **search**",
            parse_mode: "Markdown"
          });
        }
        if (text === "/list") return this.handleList(chatId, env, userId);
        
        // Default to search if not a command
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

    const getFile = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileInfo = await getFile.json();
    
    const fileRes = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`);
    const buffer = await fileRes.arrayBuffer();

    await env.AUDIO.put(fileName, buffer, {
      httpMetadata: { contentType: "audio/mpeg" }
    });
    
    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", { 
      chat_id: message.chat.id, 
      text: `✅ *Successfully Saved to R2*\nFilename: \`${fileName}\``,
      parse_mode: "Markdown"
    });
  },

  async handleList(chatId, env, userId) {
    const list = await env.AUDIO.list({ limit: 15 });
    if (list.objects.length === 0) return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: "Bucket is empty." });

    const buttons = list.objects.map(obj => {
      let row = [{ text: `🎵 ${obj.key}`, callback_data: `dl:${obj.key}` }];
      if (userId === this.ADMIN_ID) row.push({ text: "🗑️", callback_data: `del:${obj.key}` });
      return row;
    });

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: "📂 *Current R2 Library:*",
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons }
    });
  },

  async handleSearch(chatId, query, env, userId) {
    const list = await env.AUDIO.list();
    const matches = list.objects.filter(obj => obj.key.toLowerCase().includes(query.toLowerCase())).slice(0, 10);

    if (matches.length === 0) return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: chatId, text: "❌ No files found matching that name." });

    const buttons = matches.map(obj => {
      let row = [{ text: `📥 ${obj.key}`, callback_data: `dl:${obj.key}` }];
      if (userId === this.ADMIN_ID) row.push({ text: "🗑️", callback_data: `del:${obj.key}` });
      return row;
    });

    return this.tg(env.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: chatId,
      text: `🔍 *Results for:* "${query}"`,
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
    formData.append("title", fileName.replace(".mp3", "").replace(/_/g, " "));
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
