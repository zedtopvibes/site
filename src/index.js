// src/index.js
export default {
  async fetch(request, env, ctx) {
    // Handle webhook verification (Telegram sends a POST request)
    if (request.method === 'POST') {
      try {
        const body = await request.json();
        await handleUpdate(body, env);
        return new Response('OK', { status: 200 });
      } catch (error) {
        console.error('Error processing update:', error);
        return new Response('Error', { status: 500 });
      }
    }
    
    // Handle GET requests (for testing/webhook setup)
    return new Response('Bot is running! Send a message to @YourBotName', { status: 200 });
  },
};

async function handleUpdate(update, env) {
  // Check if it's a message
  if (!update.message) return;
  
  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text;
  
  // Handle /start command
  if (text === '/start') {
    await sendMessage(chatId, '🎵 Welcome to the Music Bot!\n\nI\'m your personal music assistant. I can help you discover and manage music.\n\nUse /help to see available commands.', env);
    return;
  }
  
  // Handle /help command
  if (text === '/help') {
    await sendMessage(chatId, 'Available commands:\n/start - Welcome message\n/help - Show this help\n\nMore features coming soon! 🚀', env);
    return;
  }
  
  // Default response for unknown messages
  await sendMessage(chatId, 'I only understand /start and /help for now. More features coming soon! 🎵', env);
}

async function sendMessage(chatId, text, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });
    
    if (!response.ok) {
      console.error('Telegram API error:', await response.text());
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
}