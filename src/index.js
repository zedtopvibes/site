// src/index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle webhook (Telegram POST)
    if (request.method === 'POST' && url.pathname === '/webhook') {
      try {
        const body = await request.json();
        await handleUpdate(body, env);
        return new Response('OK', { status: 200 });
      } catch (error) {
        console.error('Error:', error);
        return new Response('Error', { status: 500 });
      }
    }
    
    // Handle download page (GET requests)
    if (request.method === 'GET' && url.searchParams.has('id')) {
      const songId = url.searchParams.get('id');
      return serveDownloadPage(songId, env);
    }
    
    // Default response
    return new Response('Bot is running!', { status: 200 });
  },
};

// Store admin sessions
const adminSessions = new Map();

async function handleUpdate(update, env) {
  if (!update.message) return;
  
  const message = update.message;
  const chatId = message.chat.id;
  const userId = message.from.id;
  
  // Admin ID
  const ADMIN_ID = 5672184873;
  const isAdmin = userId === ADMIN_ID;
  
  // Handle /start with deep link
  if (message.text && message.text.startsWith('/start')) {
    const param = message.text.split(' ')[1];
    if (param && param.startsWith('download_')) {
      const songId = param.replace('download_', '');
      await handleDirectDownload(chatId, songId, env);
    } else {
      await sendMessage(chatId, "🎵 Welcome! Send a song name to search.", env);
    }
    return;
  }
  
  // Handle admin file upload
  if (isAdmin && (message.audio || message.document)) {
    const file = message.audio || message.document;
    const title = file.title;
    const performer = file.performer;
    
    if (title) {
      const artist = performer || '';
      const songId = generateId();
      await env.DB.prepare(
        'INSERT INTO songs (id, title, artist, file_id) VALUES (?, ?, ?, ?)'
      ).bind(songId, title, artist, file.file_id).run();
      
      const link = `https://aitestzmbot.zedtopvibes.workers.dev/?id=${songId}`;
      await sendMessage(chatId, `✅ Saved "${title}${artist ? ' by ' + artist : ''}"\n\nLink: ${link}`, env);
    } else {
      adminSessions.set(chatId, {
        file_id: file.file_id,
        filename: file.file_name || 'unknown'
      });
      await sendMessage(chatId, "📝 Send the song title (or Title - Artist):", env);
    }
    return;
  }
  
  // Handle admin text response
  if (message.text && isAdmin && adminSessions.has(chatId)) {
    const session = adminSessions.get(chatId);
    let title = message.text;
    let artist = '';
    
    if (title.includes(' - ')) {
      const parts = title.split(' - ');
      title = parts[0];
      artist = parts[1];
    }
    
    const songId = generateId();
    await env.DB.prepare(
      'INSERT INTO songs (id, title, artist, file_id) VALUES (?, ?, ?, ?)'
    ).bind(songId, title, artist, session.file_id).run();
    
    adminSessions.delete(chatId);
    
    const link = `https://aitestzmbot.zedtopvibes.workers.dev/?id=${songId}`;
    await sendMessage(chatId, `✅ Saved "${title}${artist ? ' by ' + artist : ''}"\n\nLink: ${link}`, env);
    return;
  }
  
  // Handle user search
  if (message.text && !isAdmin) {
    await handleUserSearch(message.text, env, chatId);
    return;
  }
  
  await sendMessage(chatId, "Send a song name to search", env);
}

async function handleUserSearch(query, env, chatId) {
  const results = await env.DB.prepare(
    'SELECT id, title, artist FROM songs WHERE title LIKE ? OR artist LIKE ? LIMIT 10'
  ).bind(`%${query}%`, `%${query}%`).all();
  
  if (results.results.length === 0) {
    await sendMessage(chatId, "❌ No songs found. Try different keywords.", env);
    return;
  }
  
  if (results.results.length === 1) {
    const song = results.results[0];
    const link = `https://aitestzmbot.zedtopvibes.workers.dev/?id=${song.id}`;
    const artistText = song.artist ? ` by ${song.artist}` : '';
    await sendMessage(chatId, `🎵 ${song.title}${artistText}\n\nGet it here: ${link}`, env);
  } else {
    let response = "🎵 Multiple songs found:\n\n";
    results.results.forEach((song, i) => {
      const artistText = song.artist ? ` - ${song.artist}` : '';
      response += `${i+1}. ${song.title}${artistText}\n`;
    });
    response += "\nSend the number to download.";
    await sendMessage(chatId, response, env);
  }
}

async function handleDirectDownload(chatId, songId, env) {
  const song = await env.DB.prepare(
    'SELECT file_id, title FROM songs WHERE id = ?'
  ).bind(songId).first();
  
  if (!song) {
    await sendMessage(chatId, "❌ Song not found.", env);
    return;
  }
  
  await sendDocument(chatId, song.file_id, env);
}

function serveDownloadPage(songId, env) {
  const botUsername = "YourBotUsername"; // Change this to your bot's username
  const telegramLink = `https://t.me/${botUsername}?start=download_${songId}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Music Bot</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body {
                font-family: system-ui, -apple-system, sans-serif;
                max-width: 600px;
                margin: 50px auto;
                padding: 20px;
                text-align: center;
                background: #f5f5f5;
            }
            .card {
                background: white;
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            a {
                display: inline-block;
                background: #0088cc;
                color: white;
                text-decoration: none;
                padding: 15px 30px;
                font-size: 18px;
                border-radius: 10px;
                margin-top: 20px;
            }
            a:hover {
                background: #006699;
            }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>🎵 Get Your Song</h1>
            <p>Click the button below to receive the song in Telegram</p>
            <a href="${telegramLink}" target="_blank">📥 Get Song</a>
        </div>
    </body>
    </html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

async function sendMessage(chatId, text, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  });
}

async function sendDocument(chatId, fileId, env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendDocument`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      document: fileId
    })
  });
}

function generateId() {
  return 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}