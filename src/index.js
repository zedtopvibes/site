export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const update = await request.json();
    const msg = update.message;
    if (!msg) return new Response("OK");

    const ADMIN_ID = 5672184873;
    const CHANNEL_ID = -1003779504495; 
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

    // Only trigger if YOU send a DOCUMENT
    if (msg.from.id === ADMIN_ID && msg.document) {
      
      // Attempt to forward
      const forwardAction = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          from_chat_id: msg.chat.id,
          message_id: msg.message_id
        })
      });

      const result = await forwardAction.json();

      if (result.ok) {
        await sendMessage(msg.chat.id, "✅ Forwarded to channel successfully!", BOT_TOKEN);
      } else {
        // This will tell us the EXACT error (e.g., "Chat not found" or "Admin rights required")
        await sendMessage(msg.chat.id, `❌ Error from Telegram: ${result.description}`, BOT_TOKEN);
      }
    }

    return new Response("OK");
  }
};

async function sendMessage(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text })
  });
}
