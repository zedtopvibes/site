export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    const ADMIN_ID = 5672184873;
    const CHANNEL_ID = -1003779504495;
    const BOT_USERNAME = "aitestzmbot";

    // --- 1. THE DOWNLOAD LANDING PAGE ---
    if (url.pathname.startsWith("/dl/")) {
      const slug = url.pathname.split("/")[2];
      const file = await env.DB.prepare("SELECT * FROM files WHERE slug = ?").bind(slug).first();

      if (!file) return new Response("File Not Found", { status: 404 });

      const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Download - ${file.file_name}</title>
          <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f7f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: white; padding: 2rem; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
              h1 { color: #333; font-size: 1.5rem; margin-bottom: 0.5rem; }
              p { color: #666; margin-bottom: 1.5rem; word-break: break-all; }
              .btn { background: #0088cc; color: white; padding: 12px 25px; text-decoration: none; border-radius: 25px; font-weight: bold; display: inline-block; transition: background 0.3s; }
              .btn:hover { background: #0077b5; }
          </style>
      </head>
      <body>
          <div class="card">
              <h1>File Ready</h1>
              <p><strong>Name:</strong> ${file.file_name}</p>
              <a href="https://t.me/${BOT_USERNAME}?start=${slug}" class="btn">Send to My Telegram</a>
          </div>
      </body>
      </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // --- 2. TELEGRAM WEBHOOK HANDLING ---
    if (request.method === "POST") {
      const update = await request.json();

      // CASE A: User clicked "Send to My Telegram" (Deep Link)
      if (update.message?.text?.startsWith("/start ")) {
        const slug = update.message.text.split(" ")[1];
        const file = await env.DB.prepare("SELECT * FROM files WHERE slug = ?").bind(slug).first();

        if (file) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: update.message.chat.id,
              document: file.file_id,
              caption: `Here is your file: ${file.file_name}`
            })
          });
        }
        return new Response("OK");
      }

      // CASE B: Admin Uploads File
      if (update.message?.document && update.message.from.id === ADMIN_ID) {
        const doc = update.message.document;
        const slug = crypto.randomUUID().split('-')[0];

        // Forward to private channel
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_ID,
            from_chat_id: update.message.chat.id,
            message_id: update.message.message_id
          })
        });

        // Save to D1 Database
        await env.DB.prepare(
          "INSERT INTO files (file_id, file_name, file_size, slug) VALUES (?, ?, ?, ?)"
        ).bind(doc.file_id, doc.file_name, doc.file_size, slug).run();

        // Reply to admin
        const downloadUrl = `https://zedtopvibes.workers.dev/dl/${slug}`;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_ID,
            text: `✅ **Stored!**\n\n**File:** ${doc.file_name}\n**Link:** ${downloadUrl}`,
            parse_mode: "Markdown"
          })
        });
      }

      return new Response("OK");
    }

    return new Response("Bot is active.");
  }
};
