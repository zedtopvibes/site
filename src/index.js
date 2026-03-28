export default {
  async fetch(request, env) {
    // Fast wake-up ping endpoint
    if (request.method === 'GET' && new URL(request.url).pathname === '/ping') {
      return new Response('OK');
    }
    
    if (request.method === 'POST') {
      const update = await request.json();
      const message = update.message;
      
      if (!message || !message.text) {
        return new Response('OK');
      }
      
      const chatId = message.chat.id;
      const userMessage = message.text;
      const messageId = message.message_id;
      const token = env.TELEGRAM_BOT_TOKEN;
      
      // ========== FAST COMMANDS (NO AI - INSTANT) ==========
      
      // 🚀 /start - Wakes up worker AND responds instantly
      if (userMessage === '/start') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🎵 *Bot Activated!*\n\nI'm awake and ready!\n\nSend any song name or artist.\nUse /help for commands.",
            parse_mode: 'Markdown',
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      // ⚡ /ping - Fast response
      if (userMessage === '/ping') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🏓 Pong! Bot is alive.",
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      // 📋 /help - Fast response
      if (userMessage === '/help') {
        const helpText = `🎵 *Music Bot Commands*
        
*Just type naturally:*
• "Play Despacito"
• "The Weeknd songs"  
• "Sad music"

*Quick Commands:*
/start — Wake up bot
/help — This menu
/ping — Check status
/search — Test search
/random — Random number

*AI will respond to any other message!*`;
        
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: helpText,
            parse_mode: 'Markdown',
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      // 🔍 /search - Test command
      if (userMessage === '/search') {
        await sendAndDelete(chatId, "🔍 Searching library...", token, 2);
        await new Promise(r => setTimeout(r, 1500));
        await sendAndDelete(chatId, "✅ Found 3 matching songs!", token, 3);
        return new Response('OK');
      }
      
      // 🎲 /random - Test command
      if (userMessage === '/random') {
        const num = Math.floor(Math.random() * 100) + 1;
        await sendAndDelete(chatId, `🎲 Random number: ${num}`, token, 4);
        return new Response('OK');
      }
      
      // ❌ /error - Test command
      if (userMessage === '/error') {
        await sendAndDelete(chatId, "❌ Error: Song not found", token, 4);
        return new Response('OK');
      }
      
      // ========== AI RESPONSE (With "Thinking" Message) ==========
      
      // Step 1: Send "thinking" instantly (user sees immediate feedback)
      const thinking = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🤔 Thinking...",
          reply_to_message_id: messageId
        })
      });
      const thinkingData = await thinking.json();
      const thinkingMsgId = thinkingData.result.message_id;
      
      // Step 2: Get AI response (worker is now warm, so faster)
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
      
      // Step 3: Edit the thinking message (no new message sent)
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: thinkingMsgId,
          text: aiResponse.response
        })
      });
      
      return new Response('OK');
    }
    
    return new Response('AI Bot is running! Send /start to wake me up.');
  }
};

// Helper function for auto-delete messages
async function sendAndDelete(chatId, text, token, seconds = 3) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
  
  const data = await response.json();
  
  if (data.ok && data.result) {
    const messageId = data.result.message_id;
    
    setTimeout(async () => {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId
        })
      }).catch(e => console.log('Delete failed:', e));
    }, seconds * 1000);
  }
}