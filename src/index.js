export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Send a POST request from Telegram.");
    }

    try {
      const update = await request.json();
      const msg = update.message;

      // Variables from your request
      const ADMIN_ID = 5672184873;
      const CHANNEL_ID = -1003779504495; 
      const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

      if (!msg) return new Response("OK");

      // 1. Check if the sender is YOU (the Admin)
      // 2. Check if the message contains a document (song/file)
      if (msg.from.id === ADMIN_ID && msg.document) {
        
        // --- THE FORWARDING ACTION ---
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_ID,      // Where it's going (The Channel)
            from_chat_id: msg.chat.id, // Where it's coming from (Your Chat)
            message_id: msg.message_id // Which message to copy
          })
        });

        const result = await response.json();

        if (result.ok) {
          // Success: Tell the admin it worked
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: "✅ File successfully backed up to the Private Channel!"
            })
          });
        } else {
          // Error: Tell the admin why it failed (usually permissions)
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              text: `❌ Failed to forward: ${result.description}`
            })
          });
        }
      }

      return new Response("OK");
    } catch (e) {
      return new Response("Error: " + e.message);
    }
  }
};
