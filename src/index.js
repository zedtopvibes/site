export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('ZedTopVibes R2 Bot Active');
    }

    const update = await request.json();
    const message = update.message;

    if (message?.text) {
      const chatId = message.chat.id;
      const text = message.text;
      const token = env.TELEGRAM_BOT_TOKEN;

      // --- Command: /list ---
      if (text === '/list') {
        // Fetch list of files from R2
        const list = await env.AUDIO.list({ limit: 10 });
        const fileNames = list.objects.map(obj => obj.key).join('\n');
        
        const responseText = fileNames.length > 0 
          ? `📂 *Files in R2:*\n${fileNames}` 
          : "Your R2 bucket is empty.";

        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: responseText,
            parse_mode: 'Markdown'
          })
        });
      } 
      
      // --- Default Response ---
      else {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "Bot is cool! Use /list to see files."
          })
        });
      }
    }

    return new Response('OK');
  }
};
