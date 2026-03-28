export default {
  async fetch(request, env) {
    // Only handle POST requests (Telegram webhook)
    if (request.method === 'POST') {
      const update = await request.json();
      
      // Get the message
      const message = update.message;
      if (!message || !message.text) {
        return new Response('OK');
      }
      
      const chatId = message.chat.id;
      const userMessage = message.text;
      const messageId = message.message_id;  // ← Get original message ID
      
      // Send typing indicator
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          action: 'typing'
        })
      });
      
      // Send to AI and get response
      const aiResponse = await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct",
        {
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant. Keep responses short and friendly."
            },
            {
              role: "user",
              content: userMessage
            }
          ]
        }
      );
      
      // Send AI response as a REPLY to the original message
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: aiResponse.response,
          reply_to_message_id: messageId  // ← This makes it a reply
        })
      });
      
      return new Response('OK');
    }
    
    return new Response('AI Bot is running! Send a message on Telegram to test.');
  }
};