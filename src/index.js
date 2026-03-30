// src/index.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle webhook setup
    if (url.pathname === '/webhook/setup') {
      return await setupWebhook(request, env);
    }
    
    // Handle Telegram webhook updates
    if (url.pathname === '/webhook') {
      return await handleTelegramUpdate(request, env);
    }
    
    // Simple health check
    return new Response('Telegram bot is running!', { status: 200 });
  }
};

// Setup webhook with Telegram
async function setupWebhook(request, env) {
  const webhookUrl = `${new URL(request.url).origin}/webhook`;
  const token = env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    return new Response('TELEGRAM_BOT_TOKEN not set', { status: 500 });
  }
  
  const response = await fetch(
    `https://api.telegram.org/bot${token}/setWebhook?url=${webhookUrl}`
  );
  
  const result = await response.json();
  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

// Handle incoming Telegram updates
async function handleTelegramUpdate(request, env) {
  const update = await request.json();
  console.log('Received update:', update);
  
  // Handle different update types
  if (update.message) {
    await handleMessage(update.message, env);
  }
  
  return new Response('OK', { status: 200 });
}

// Handle incoming messages
async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const text = message.text;
  
  // Basic commands
  if (text === '/start') {
    await sendMessage(chatId, 'Welcome! Send me a file and I\'ll store it in R2.', env);
    return;
  }
  
  // Handle files
  if (message.document) {
    await handleDocument(message, env);
  } else if (message.voice) {
    await handleVoice(message, env);
  } else if (message.audio) {
    await handleAudio(message, env);
  } else if (text) {
    await sendMessage(chatId, 'Send me a file, voice message, or audio file to store in R2!', env);
  }
}

// Handle document files
async function handleDocument(message, env) {
  const chatId = message.chat.id;
  const document = message.document;
  const fileId = document.file_id;
  const fileName = document.file_name;
  const fileSize = document.file_size;
  
  await sendMessage(chatId, `📁 Receiving: ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`, env);
  
  try {
    // Get file URL from Telegram
    const fileUrl = await getTelegramFileUrl(fileId, env);
    
    // Download file
    const fileResponse = await fetch(fileUrl);
    const fileBuffer = await fileResponse.arrayBuffer();
    
    // Upload to R2
    const key = `${Date.now()}_${fileName}`;
    await env.AUDIO.put(key, fileBuffer, {
      httpMetadata: {
        contentType: document.mime_type,
        contentDisposition: `attachment; filename="${fileName}"`
      }
    });
    
    await sendMessage(chatId, `✅ File saved to R2!\n📦 Bucket: zedtopvibes-audio\n🔑 Key: ${key}`, env);
    
  } catch (error) {
    console.error('Error handling document:', error);
    await sendMessage(chatId, '❌ Failed to save file to R2', env);
  }
}

// Handle voice messages
async function handleVoice(message, env) {
  const chatId = message.chat.id;
  const voice = message.voice;
  const fileId = voice.file_id;
  const duration = voice.duration;
  
  await sendMessage(chatId, `🎤 Receiving voice message (${duration}s)`, env);
  
  try {
    const fileUrl = await getTelegramFileUrl(fileId, env);
    const fileResponse = await fetch(fileUrl);
    const fileBuffer = await fileResponse.arrayBuffer();
    
    const key = `voice_${Date.now()}.ogg`;
    await env.AUDIO.put(key, fileBuffer, {
      httpMetadata: {
        contentType: 'audio/ogg',
        contentDisposition: `inline; filename="${key}"`
      }
    });
    
    await sendMessage(chatId, `✅ Voice message saved to R2!\n📦 Bucket: zedtopvibes-audio\n🔑 Key: ${key}`, env);
    
  } catch (error) {
    console.error('Error handling voice:', error);
    await sendMessage(chatId, '❌ Failed to save voice message to R2', env);
  }
}

// Handle audio files
async function handleAudio(message, env) {
  const chatId = message.chat.id;
  const audio = message.audio;
  const fileId = audio.file_id;
  const fileName = audio.file_name || `audio_${Date.now()}.mp3`;
  
  await sendMessage(chatId, `🎵 Receiving: ${fileName}`, env);
  
  try {
    const fileUrl = await getTelegramFileUrl(fileId, env);
    const fileResponse = await fetch(fileUrl);
    const fileBuffer = await fileResponse.arrayBuffer();
    
    const key = `${Date.now()}_${fileName}`;
    await env.AUDIO.put(key, fileBuffer, {
      httpMetadata: {
        contentType: audio.mime_type || 'audio/mpeg',
        contentDisposition: `inline; filename="${fileName}"`
      }
    });
    
    await sendMessage(chatId, `✅ Audio saved to R2!\n📦 Bucket: zedtopvibes-audio\n🔑 Key: ${key}`, env);
    
  } catch (error) {
    console.error('Error handling audio:', error);
    await sendMessage(chatId, '❌ Failed to save audio to R2', env);
  }
}

// Helper: Get file URL from Telegram
async function getTelegramFileUrl(fileId, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const response = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`
  );
  
  const data = await response.json();
  if (!data.ok) throw new Error('Failed to get file info');
  
  const filePath = data.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

// Helper: Send message to Telegram
async function sendMessage(chatId, text, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    })
  });
}