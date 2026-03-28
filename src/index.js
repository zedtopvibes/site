export default {
  async fetch(request, env) {
    if (request.method === 'POST') {
      const update = await request.json();
      const message = update.message;
      
      if (!message || !message.text) {
        return new Response('OK');
      }
      
      const chatId = message.chat.id;
      const userMessage = message.text;
      const messageId = message.message_id;
      
      // ✅ SAFE: Token from environment, not hardcoded
      const token = env.TELEGRAM_BOT_TOKEN;
      
      // Send typing indicator
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          action: 'typing'
        })
      });
      
      // AI response
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
      
      // Send reply
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: aiResponse.response,
          reply_to_message_id: messageId
        })
      });
      
      return new Response('OK');
    }
    
    return new Response('AI Bot is running!');
  }
};