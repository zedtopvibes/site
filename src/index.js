export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const update = await request.json();
    const msg = update.message;
    if (!msg) return new Response("OK");

    const ADMIN_ID = 5672184873;
    const CHANNEL_ID = -1003779504495;
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

    // Trigger only for YOU
    if (msg.from.id === ADMIN_ID) {
      
      // Attempt to forward ANY message you send
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          from_chat_id: msg.chat.id,
          message_id: msg.message_id
        })
      });

      const result = await res.json();

      // Report back to you exactly what happened
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          text: result.ok ? "✅ Forwarded!" : `❌ Error: ${result.description}`
        })
      });
    }

    return new Response("OK");
  }
};
