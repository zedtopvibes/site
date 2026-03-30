export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
    const ADMIN_ID = 5672184873;
    const CHANNEL_ID = -1003779504495;
    const BOT_USERNAME = "aitestzmbot";

    // --- 1. THE DOWNLOAD PAGE (HTML) ---
    if (url.pathname.startsWith("/dl/")) {
      const slug = url.pathname.split("/")[2];
      const file = await env.DB.prepare("SELECT * FROM files WHERE slug = ?").bind(slug).first();

      if (!file) return new Response("File not found.", { status: 404 });

      // Professional UI for the download page
      const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Download ${file.file_name}</title>
          <style>
              body { font-family: 'Inter', sans-serif; background: #0f172a; color: white; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2.5rem; border-radius: 1.5rem; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); text-align: center; max-width: 400px; width: 90%; border: 1px solid #334155; }
              h1 { font-size: 1.25rem; margin-bottom: 1rem; color: #38bdf8; }
              p { font-size: 0.9rem; color: #94a3b8; margin-bottom: 2rem; line-height: 1.5; }
              .btn { background: #38bdf8; color: #0f172a; padding: 0.8rem 2rem; text-decoration: none; border-radius: 0.75rem; font-weight: 700; display: inline-block; transition: all 0.2s; }
              .btn:hover { background: #7dd3fc; transform: translateY(-2px); }
          </style>
      </head>
      <body>
          <div class="card">
              <h1>File Ready</h1>
              <p>You requested: <br><strong>${file.file_name}</strong></p>
              <a href="https://t.me/${BOT_USERNAME}?start=${slug}" class="btn">Get File in Telegram</a>
          </div>
      </body>
      </html>`;
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    }

    // --- 2. TELEGRAM BOT LOGIC ---
    if (request.method === "POST") {
      const update = await request.json();
      const msg = update.message;
      if (!msg) return new Response("OK");

      // CASE A: User clicked the website button (Deep Link)
      if (msg.text?.startsWith("/start ")) {
        const slug = msg.text.split(" ")[1];
        const file = await env.DB.prepare("SELECT * FROM files WHERE slug = ?").bind(slug).first();

        if (file) {
          await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: msg.chat.id,
              document: file.file_id,
              caption: `🎵 Sent via ZedTop Vibes\nFile: ${file.file_name}`
            })
          });
        }
        return new Response("OK");
      }

      // CASE B: Admin Uploading a File
      if (msg.from.id === ADMIN_ID && msg.document) {
        const slug = crypto.randomUUID().split('-')[0];

        // 1. Forward to Private Channel
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/forwardMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHANNEL_ID,
            from_chat_id: msg.chat.id,
            message_id: msg.message_id
          })
        });

        // 2. Save to D1
        await env.DB.prepare("INSERT INTO files (file_id, file_name, slug) VALUES (?, ?, ?)")
          .bind(msg.document.file_id, msg.document.file_name, slug).run();

        // 3. Send Download Link back to Admin
        const link = `https://zedtopvibes.workers.dev/dl/${slug}`;
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_ID,
            text: `✅ **File Stored & Linked!**\n\n**Name:** \`${msg.document.file_name}\`\n**Link:** ${link}`,
            parse_mode: "Markdown"
          })
        });
      }
      return new Response("OK");
    }

    return new Response("Worker is active.");
  }
};
