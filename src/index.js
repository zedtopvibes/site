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
      
      // /start - Wakes up worker and responds instantly
      if (userMessage === '/start') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🎵 *Bot Activated!*\n\nI'm awake and ready!\n\nSend any message to chat with AI.\nUse /help for all commands.",
            parse_mode: 'Markdown',
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      // /ping - Fast test
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
      
      // /help - All commands
      if (userMessage === '/help') {
        const helpText = `🎵 *Music Bot Commands*
        
*🎤 Music Tasks:*
/recommend — Song recommendations
/mood — Mood-based songs
/discover [artist] — Find similar artists
/playlist — Create a playlist
/meaning [song] — Song meaning
/trivia — Music trivia
/throwback [year] — Music from that year

*🎲 Fun AI Tasks:*
/joke — Tell a joke
/fact — Random fun fact
/quote — Inspiring quote
/riddle — Solve a riddle
/poem [topic] — Write a poem
/story — Story starter
/compliment — Get a compliment
/advice [topic] — Get advice
/wyr — Would you rather
/namegen [style] — Generate names
/recipe — Quick recipe idea

*⚡ Quick Commands:*
/start — Wake up bot
/ping — Check status
/search — Test search
/random — Random number
/task — Multi-step demo
/countdown — Fun countdown
/status — System status
/weather — Weather simulation

*Just type anything to chat with AI!*`;
        
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
      
      // ========== QUICK TEST COMMANDS (Auto-Delete) ==========
      
      // /search - Simulated search
      if (userMessage === '/search') {
        await sendAndDelete(chatId, "🔍 Searching library...", token, 2);
        await new Promise(r => setTimeout(r, 1500));
        await sendAndDelete(chatId, "✅ Found 3 matching songs!", token, 3);
        return new Response('OK');
      }
      
      // /random - Random number
      if (userMessage === '/random') {
        const num = Math.floor(Math.random() * 100) + 1;
        await sendAndDelete(chatId, `🎲 Random number: ${num}`, token, 4);
        return new Response('OK');
      }
      
      // /task - Multi-step demo
      if (userMessage === '/task') {
        await sendAndDelete(chatId, "📊 Step 1/3: Analyzing...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "⚙️ Step 2/3: Processing...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "✅ Step 3/3: Complete!", token, 3);
        return new Response('OK');
      }
      
      // /status - System status
      if (userMessage === '/status') {
        await sendAndDelete(chatId, "📊 Checking system status...", token, 2);
        await new Promise(r => setTimeout(r, 1000));
        await sendAndDelete(chatId, "✅ Database: Connected\n✅ AI: Ready\n✅ Storage: Online", token, 5);
        return new Response('OK');
      }
      
      // /weather - Weather simulation
      if (userMessage === '/weather') {
        const conditions = ['☀️ Sunny', '🌧️ Rainy', '☁️ Cloudy', '🌤️ Partly Cloudy'];
        const temp = Math.floor(Math.random() * 30) + 10;
        const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
        await sendAndDelete(chatId, `🌤️ Weather: ${randomCondition}\n🌡️ Temperature: ${temp}°C`, token, 5);
        return new Response('OK');
      }
      
      // /countdown - Fun countdown
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
      
      // ========== RANDOM AI TASKS ==========
      
      // /joke - Tell a joke
      if (userMessage === '/joke') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Tell a short, funny joke. Make it clean and family-friendly." },
              { role: "user", content: "Tell me a joke" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /fact - Random fun fact
      if (userMessage === '/fact') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Share an interesting, surprising fun fact. Keep it short and engaging." },
              { role: "user", content: "Give me a fun fact" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /quote - Inspiring quote
      if (userMessage === '/quote') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Give an inspiring quote with the author. Format: 'Quote' - Author" },
              { role: "user", content: "Give me an inspiring quote" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /riddle - Give a riddle
      if (userMessage === '/riddle') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Give a short riddle. Don't give the answer yet." },
              { role: "user", content: "Give me a riddle" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /poem - Write a poem
      if (userMessage.startsWith('/poem')) {
        const topic = userMessage.replace('/poem', '').trim() || "love";
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: `Write a short, beautiful poem about ${topic}. 4-6 lines.` },
              { role: "user", content: `Write a poem about ${topic}` }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /story - Story starter
      if (userMessage === '/story') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Give an exciting opening sentence for a story. Make it intriguing." },
              { role: "user", content: "Start a story" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /compliment - Give a compliment
      if (userMessage === '/compliment') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Give a genuine, friendly compliment. Keep it short and positive." },
              { role: "user", content: "Give me a compliment" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /advice - Get advice
      if (userMessage.startsWith('/advice')) {
        const topic = userMessage.replace('/advice', '').trim() || "life";
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: `Give brief, helpful advice about ${topic}. Keep it short and practical.` },
              { role: "user", content: `Give me advice about ${topic}` }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /wyr - Would you rather
      if (userMessage === '/wyr') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Give a fun 'Would you rather...' question with two interesting options." },
              { role: "user", content: "Give me a would you rather question" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /namegen - Generate names
      if (userMessage.startsWith('/namegen')) {
        const style = userMessage.replace('/namegen', '').trim() || "fantasy";
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: `Generate 5 creative ${style} names. List them with numbers.` },
              { role: "user", content: `Give me 5 ${style} names` }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /recipe - Quick recipe idea
      if (userMessage === '/recipe') {
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Suggest a quick, easy recipe idea with ingredients and simple steps." },
              { role: "user", content: "Give me a quick recipe idea" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // ========== MUSIC AI TASKS (Multi-Step) ==========
      
      // /recommend - Song recommendations
      if (userMessage === '/recommend') {
        await sendAndDelete(chatId, "🔍 Step 1/4: Analyzing your music taste...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎵 Step 2/4: Scanning library for similar songs...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "📊 Step 3/4: Checking popularity trends...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "✨ Step 4/4: Curating your playlist...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Recommend 3 popular songs based on current trends. Format nicely with emojis." },
              { role: "user", content: "Recommend me some songs" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /mood - Mood-based songs
      if (userMessage === '/mood') {
        await sendAndDelete(chatId, "🎭 Step 1/4: Detecting your mood...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🔊 Step 2/4: Analyzing tempo and energy...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎯 Step 3/4: Matching with songs in library...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎵 Step 4/4: Selecting perfect match...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Suggest songs based on mood: upbeat, chill, or emotional. Pick one mood and recommend 2 songs." },
              { role: "user", content: "What songs match my mood?" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /discover - Find similar artists
      if (userMessage.startsWith('/discover')) {
        const artist = userMessage.replace('/discover', '').trim() || "popular artist";
        
        await sendAndDelete(chatId, "🔍 Step 1/4: Finding similar artists...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "📀 Step 2/4: Analyzing musical style...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎤 Step 3/4: Checking fan favorites...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "✨ Step 4/4: Discovering hidden gems...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: `Recommend 3 artists similar to ${artist}. Give brief why they're similar.` },
              { role: "user", content: `Find artists like ${artist}` }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /playlist - Create playlist
      if (userMessage === '/playlist') {
        await sendAndDelete(chatId, "📝 Step 1/4: Understanding your vibe...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎵 Step 2/4: Browsing top tracks...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🔄 Step 3/4: Mixing genres for variety...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "📀 Step 4/4: Creating your perfect playlist...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Create a 5-song playlist with variety. Include song titles and artists. Format nicely." },
              { role: "user", content: "Create a playlist for me" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /meaning - Song meaning
      if (userMessage.startsWith('/meaning')) {
        const song = userMessage.replace('/meaning', '').trim() || "a popular song";
        
        await sendAndDelete(chatId, "📖 Step 1/4: Loading lyrics...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🔍 Step 2/4: Analyzing metaphors...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎭 Step 3/4: Understanding artist's intent...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "💡 Step 4/4: Interpreting the meaning...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: `Explain the meaning behind "${song}" briefly. What's the song about?` },
              { role: "user", content: `What does ${song} mean?` }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /trivia - Music trivia
      if (userMessage === '/trivia') {
        await sendAndDelete(chatId, "🎮 Step 1/4: Loading music database...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "📊 Step 2/4: Selecting random artist...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "❓ Step 3/4: Generating question...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "✨ Step 4/4: Ready!", token, 2);
        await new Promise(r => setTimeout(r, 500));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "Give a fun music trivia question with 4 options. Format: Question\nA) ...\nB) ...\nC) ...\nD) ..." },
              { role: "user", content: "Give me music trivia" }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // /throwback - Music from specific year
      if (userMessage.startsWith('/throwback')) {
        const year = userMessage.replace('/throwback', '').trim() || "2000";
        
        await sendAndDelete(chatId, `📅 Step 1/4: Loading ${year} music charts...`, token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🎤 Step 2/4: Finding top artists...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "🏆 Step 3/4: Identifying hit songs...", token, 2);
        await new Promise(r => setTimeout(r, 800));
        await sendAndDelete(chatId, "⏰ Step 4/4: Time travel complete!", token, 2);
        await new Promise(r => setTimeout(r, 800));
        
        const thinkingId = await sendThinking(chatId, token, messageId);
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: `List 3 popular songs from ${year}. Include artists. Add a fun fact about music in ${year}.` },
              { role: "user", content: `What were popular songs in ${year}?` }
            ]
          }
        );
        await editThinking(chatId, thinkingId, aiResponse.response, token);
        return new Response('OK');
      }
      
      // ========== DEFAULT: AI CONVERSATION ==========
      
      // Send "thinking" message instantly
      const thinkingId = await sendThinking(chatId, token, messageId);
      
      // Get AI response
      const aiResponse = await env.AI.run(
        "@cf/meta/llama-3.1-8b-instruct",
        {
          messages: [
            {
              role: "system",
              content: "You are a helpful music assistant. Keep responses short and friendly. Use emojis occasionally."
            },
            {
              role: "user",
              content: userMessage
            }
          ]
        }
      );
      
      // Edit thinking message with final response
      await editThinking(chatId, thinkingId, aiResponse.response, token);
      
      return new Response('OK');
    }
    
    return new Response('AI Bot is running! Send /start to wake me up.');
  }
};

// ========== HELPER FUNCTIONS ==========

// Send temporary auto-delete message
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

// Send thinking message and return message ID
async function sendThinking(chatId, token, replyToId) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: "🤔 Thinking...",
      reply_to_message_id: replyToId
    })
  });
  const data = await response.json();
  return data.result.message_id;
}

// Edit thinking message with final response
async function editThinking(chatId, messageId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}