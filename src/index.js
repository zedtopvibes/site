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
      const token = env.TELEGRAM_BOT_TOKEN;
      
      // Show typing indicator
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        body: JSON.stringify({ chat_id: chatId, action: 'typing' })
      });
      
      // === TEST COMMANDS WITH AUTO-DELETE ===
      
      // Test 1: Simple ping
      if (userMessage === '/ping') {
        await sendAndDelete(chatId, "🏓 Pong! ✅", token, 3);
        return new Response('OK');
      }
      
      // Test 2: Echo with cleanup
      if (userMessage.startsWith('/echo')) {
        const text = userMessage.replace('/echo', '').trim();
        await sendAndDelete(chatId, `📢 You said: ${text}`, token, 4);
        return new Response('OK');
      }
      
      // Test 3: Search simulation
      if (userMessage.toLowerCase().includes('search') || userMessage === '/search') {
        await sendAndDelete(chatId, "🔍 Searching...", token, 2);
        await new Promise(r => setTimeout(r, 1500));
        await sendAndDelete(chatId, "✅ Search complete! Found results.", token, 3);
        return new Response('OK');
      }
      
      // Test 4: Error simulation
      if (userMessage === '/error') {
        await sendAndDelete(chatId, "❌ Something went wrong. Try again.", token, 4);
        return new Response('OK');
      }
      
      // Test 5: Multi-step task
      if (userMessage === '/task') {
        await sendAndDelete(chatId, "⏳ Step 1/3: Initializing...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "⚙️ Step 2/3: Processing data...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "✅ Step 3/3: Complete! Task finished.", token, 4);
        return new Response('OK');
      }
      
      // Test 6: Help with auto-delete
      if (userMessage === '/test') {
        const helpText = `🧪 *Test Commands*
        
/ping — Test response
/echo [text] — Echo with cleanup
/search — Simulate search
/error — Show error message
/task — Multi-step task
/help — Show this menu

*Features:* All responses auto-delete after 3-5 seconds!`;
        
        await sendAndDelete(chatId, helpText, token, 8);
        return new Response('OK');
      }
      
      // Default: AI response with cleanup
      const aiResponse = await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct",
        {
          messages: [
            { role: "system", content: "You are a helpful assistant. Keep responses short." },
            { role: "user", content: userMessage }
          ]
        }
      );
      
      // Send AI response (permanent)
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        body: JSON.stringify({
          chat_id: chatId,
          text: aiResponse.response,
          reply_to_message_id: messageId
        })
      });
      
      // Send completion confirmation (auto-delete)
      await sendAndDelete(chatId, "✅ Done!", token, 2);
      
      return new Response('OK');
    }
    
    return new Response('Test Bot with Auto-Delete! Try /test');
  }
};

// Auto-delete helper
async function sendAndDelete(chatId, text, token, seconds = 3) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
  
  const data = await response.json();
  const messageId = data.result.message_id;
  
  setTimeout(async () => {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: 'POST',
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId
      })
    });
  }, seconds * 1000);
  
  return messageId;
}