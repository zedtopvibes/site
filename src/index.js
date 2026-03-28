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
      
      // Step 1: Show "typing..." while processing
      await sendAction(chatId, 'typing', env);
      
      // Analyze if it's a song request
      const isSongRequest = userMessage.toLowerCase().includes('play') || 
                            userMessage.toLowerCase().includes('song');
      
      let response;
      
      if (isSongRequest) {
        // Step 2: Show "upload_audio" while preparing file
        await sendAction(chatId, 'upload_audio', env);
        
        // Simulate searching for song
        response = await searchSong(userMessage, env);
        
        // Step 3: Show "typing" again for final message
        await sendAction(chatId, 'typing', env);
        
      } else {
        // Just regular chat response
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: userMessage }
            ]
          }
        );
        response = aiResponse.response;
      }
      
      // Send final message
      await sendTelegramMessage(chatId, response, env);
      
      return new Response('OK');
    }
    
    return new Response('AI Bot is running!');
  }
};

// Helper function to send actions
async function sendAction(chatId, action, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action: action
    })
  });
}

// Helper function to send messages
async function sendTelegramMessage(chatId, text, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

// Mock search function
async function searchSong(query, env) {
  // Your actual song search logic here
  return `🎵 Found songs matching "${query}"!\nUse /download to get them.`;
}