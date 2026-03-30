export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const update = await request.json();
    const msg = update.message;
    if (!msg) return new Response("OK");
 
    const ADMIN_ID = 5672184873;
    const CHANNEL_ID = -1003779504495;
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

    // Only process if YOU (Admin) send a DOCUMENT
    if (msg.from.id === ADMIN_ID && msg.document) {
      const doc = msg.document;
      const slug = crypto.randomUUID().split('-')[0]; // Creates a unique 8-char code

      // 1. Forward to Channel (Persistence)
      const forward = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHANNEL_ID,
          from_chat_id: msg.chat.id,
          message_id: msg.message_id
        })
      });

      const forwardResult = await forward.json();

      if (forwardResult.ok) {
        // 2. Save to D1 Database
        try {
          await env.DB.prepare(
            "INSERT INTO files (file_id, file_name, file_size, slug) VALUES (?, ?, ?, ?)"
          ).bind(doc.file_id, doc.file_name, doc.file_size, slug).run();

          // 3. Send the Link back to you
          const downloadUrl = `https://zedtopvibes.workers.dev/dl/${slug}`;
          await sendMessage(msg.chat.id, `✅ **File Saved!**\n\n**Name:** ${doc.file_name}\n**Link:** ${downloadUrl}`, BOT_TOKEN);
          
        } catch (dbError) {
          await sendMessage(msg.chat.id, `❌ Database Error: ${dbError.message}`, BOT_TOKEN);
        }
      } else {
        await sendMessage(msg.chat.id, `❌ Forwarding failed: ${forwardResult.description}`, BOT_TOKEN);
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
