export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const update = await request.json();
    const msg = update.message;
    if (!msg) return new Response("OK");

    const ADMIN_ID = 5672184873;
    const CHANNEL_ID = -1003779504495;
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

    // 1. DATABASE CHECK (Safety Catch)
    if (!env.DB) {
      await sendMessage(msg.chat.id, "❌ Error: D1 Database binding 'DB' not found in wrangler.toml", BOT_TOKEN);
      return new Response("OK");
    }

    // 2. ADMIN UPLOAD LOGIC
    if (msg.from.id === ADMIN_ID && msg.document) {
      const doc = msg.document;
      const slug = crypto.randomUUID().split('-')[0]; 

      // Attempt Forwarding
      const forward = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          from_chat_id: msg.chat.id,
          message_id: msg.message_id
        })
      });

      const forwardRes = await forward.json();

      if (forwardRes.ok) {
        try {
          // Attempt Database Insert
          await env.DB.prepare(
            "INSERT INTO files (file_id, file_name, file_size, slug) VALUES (?, ?, ?, ?)"
          ).bind(doc.file_id, doc.file_name, doc.file_size, slug).run();

          const downloadUrl = `https://zedtopvibes.workers.dev/dl/${slug}`;
          await sendMessage(msg.chat.id, `✅ **Stored!**\n\nName: \`${doc.file_name}\`\nLink: ${downloadUrl}`, BOT_TOKEN);
          
        } catch (e) {
          // This catches if the TABLE "files" doesn't exist yet
          await sendMessage(msg.chat.id, `❌ Database Error: ${e.message}\n\nDid you run the 'CREATE TABLE' command?`, BOT_TOKEN);
        }
      } else {
        await sendMessage(msg.chat.id, `❌ Forwarding Error: ${forwardRes.description}`, BOT_TOKEN);
      }
    }

    return new Response("OK");
  }
};

async function sendMessage(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" })
  });
}
