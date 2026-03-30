export default {
  async fetch(request, env) {
    // 1. Handle browser visits (Verification)
    if (request.method === "GET") {
      return new Response("Worker is ALIVE! Now send a message to your bot in Telegram.");
    }

    // 2. Handle Telegram Messages
    if (request.method === "POST") {
      try {
        const update = await request.json();
        const chatId = update.message?.chat.id;
        const text = update.message?.text;
        const userId = update.message?.from.id;

        // Simple Echo Response
        if (chatId && text) {
          const message = `Test Successful! \nYour ID: ${userId}\nMessage: ${text}`;
          
          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: message
            })
          });
        }
      } catch (e) {
        return new Response("Error: " + e.message);
      }
    }

    return new Response("OK", { status: 200 });
  }
};
