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
      
      // ========== TEXT TASKS (with auto-delete) ==========
      
      // Task 1: Ping test
      if (userMessage === '/ping') {
        await sendAndDelete(chatId, "🏓 Pong! ✅", token, 3);
        return new Response('OK');
      }
      
      // Task 2: Search simulation
      if (userMessage === '/search') {
        await sendAndDelete(chatId, "🔍 Searching library...", token, 2);
        await new Promise(r => setTimeout(r, 1500));
        await sendAndDelete(chatId, "✅ Found 3 matching songs!", token, 3);
        return new Response('OK');
      }
      
      // Task 3: Error simulation
      if (userMessage === '/error') {
        await sendAndDelete(chatId, "❌ Error: Song not found in library", token, 4);
        return new Response('OK');
      }
      
      // Task 4: Multi-step task
      if (userMessage === '/task') {
        await sendAndDelete(chatId, "📊 Step 1/3: Analyzing...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "⚙️ Step 2/3: Processing...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "✅ Step 3/3: Complete!", token, 3);
        return new Response('OK');
      }
      
      // Task 5: Echo (with cleanup)
      if (userMessage.startsWith('/echo ')) {
        const text = userMessage.replace('/echo ', '');
        await sendAndDelete(chatId, `📢 You said: "${text}"`, token, 4);
        return new Response('OK');
      }
      
      // Task 6: Help menu
      if (userMessage === '/tasks') {
        const helpText = `🧪 *Available Tasks*
        
/ping — Test response
/search — Simulate search
/error — Show error message
/task — Multi-step progress
/echo [text] — Echo with cleanup
/status — System status
/random — Random number
/weather — Weather simulation

*All responses auto-delete after 3-5 seconds!*`;
        
        await sendAndDelete(chatId, helpText, token, 10);
        return new Response('OK');
      }
      
      // Task 7: Status check
      if (userMessage === '/status') {
        await sendAndDelete(chatId, "📊 Checking system status...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "✅ Database: Connected\n✅ AI: Ready\n✅ Storage: Online", token, 5);
        return new Response('OK');
      }
      
      // Task 8: Random number
      if (userMessage === '/random') {
        const num = Math.floor(Math.random() * 100) + 1;
        await sendAndDelete(chatId, `🎲 Random number: ${num}`, token, 4);
        return new Response('OK');
      }
      
      // Task 9: Weather simulation
      if (userMessage === '/weather') {
        const conditions = ['☀️ Sunny', '🌧️ Rainy', '☁️ Cloudy', '🌤️ Partly Cloudy'];
        const temp = Math.floor(Math.random() * 30) + 10;
        const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
        await sendAndDelete(chatId, `🌤️ Weather: ${randomCondition}\n🌡️ Temperature: ${temp}°C`, token, 5);
        return new Response('OK');
      }
      
      // Task 10: Countdown
      if (userMessage === '/countdown') {
        await sendAndDelete(chatId, "⏳ 3...", token, 1);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "⏳ 2...", token, 1);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "⏳ 1...", token, 1);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "🎉 Blast off!", token, 3);
        return new Response('OK');
      }
      
      // ========== END TEXT TASKS ==========
      
      // Send typing indicator for AI
      await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          action: 'typing'
        })
      });
      
      // AI response for regular messages
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
      
      // Send AI reply (permanent)
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: aiResponse.response,
          reply_to_message_id: messageId
        })
      });
      
      // Send temporary "done" message (auto-delete)
      await sendAndDelete(chatId, "✅ Done!", token, 2);
      
      return new Response('OK');
    }
    
    return new Response('AI Bot is running! Send a message on Telegram to test.');
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