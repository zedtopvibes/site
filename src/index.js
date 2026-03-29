export default {
  async fetch(request, env) {
    // Ping endpoint (keeps worker warm)
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
      const userId = message.from.id;
      const username = message.from.username || message.from.first_name;
      const userMessage = message.text;
      const messageId = message.message_id;
      const token = env.TELEGRAM_BOT_TOKEN;
      
      // ========== CHECK IF USER EXISTS ==========
      const userExists = await env.DB.prepare(
        "SELECT 1 FROM bot_users WHERE user_id = ?"
      ).bind(userId).first();
      
      // FIRST MESSAGE EVER (Instant, No AI)
      if (!userExists) {
        await env.DB.prepare(`
          INSERT INTO bot_users (user_id, username, first_name, last_active)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(userId, username, message.from.first_name).run();
        
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎵 *Welcome to ZEDTOP VIBES Bot!* 🇿🇲\n\n` +
                  `I'm your Zambian music assistant.\n\n` +
                  `🎤 *Try these:*\n` +
                  `• Send any artist name (e.g., "Yo Maps")\n` +
                  `• Send a song name (e.g., "Ndipe Mwe")\n` +
                  `• /genre gospel — Browse by genre\n` +
                  `• /trending — What's hot\n` +
                  `• /help — All commands\n\n` +
                  `Ready when you are! 🎵`,
            parse_mode: 'Markdown',
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      // Update last active
      await env.DB.prepare(`
        UPDATE bot_users SET last_active = CURRENT_TIMESTAMP 
        WHERE user_id = ?
      `).bind(userId).run();
      
      // ========== FAST COMMANDS (NO AI) ==========
      
      // /start
      if (userMessage === '/start') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🎵 *ZEDTOP VIBES Bot Ready!*\n\nSend an artist name, song name, or /help",
            parse_mode: 'Markdown',
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      // /help
      if (userMessage === '/help') {
        const helpText = `🎵 *ZEDTOP VIBES Bot Commands*
        
*🎤 Music:*
• Send any artist name (e.g., "Yo Maps")
• Send any song name (e.g., "Ndipe Mwe")
• /artist [name] — Artist details
• /genre [genre] — Browse by genre

*📋 Commands:*
/trending — Most downloaded songs
/featured — Featured artists
/legends — Zambian music legends
/testdb — Test database connection

*✨ Just type naturally!*`;
        
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
      
      // /ping
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
      
      // ========== DATABASE TEST COMMAND ==========
      
      if (userMessage === '/testdb') {
        await sendAction(chatId, 'typing', token);
        
        try {
          // Test 1: Read from D1
          const artists = await env.DB.prepare(`
            SELECT name, genre, total_downloads, total_tracks
            FROM artists 
            WHERE status = 'active'
            ORDER BY total_downloads DESC
            LIMIT 5
          `).all();
          
          let response = "🎵 *Top Artists in Database*\n\n";
          
          if (artists.results.length === 0) {
            response = "❌ No artists found in database.\n";
          } else {
            artists.results.forEach((a, i) => {
              response += `${i+1}. *${a.name}*\n`;
              response += `   🏷️ ${a.genre || 'No genre'} | ⭐ ${a.total_downloads || 0} downloads\n`;
            });
          }
          
          // Test 2: Get total songs count
          const songsCount = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM songs WHERE status = 'active'
          `).first();
          
          response += `\n📀 *Total songs:* ${songsCount?.count || 0}\n`;
          
          // Test 3: List files in R2
          const files = await env.AUDIO.list();
          response += `📁 *R2 Storage:* ${files.objects?.length || 0} files`;
          
          await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
          
        } catch (error) {
          await sendMessage(chatId, `❌ Error: ${error.message}`, token);
        }
        return new Response('OK');
      }
      
      // ========== ARTIST SEARCH ==========
      
      if (userMessage.startsWith('/artist')) {
        const artistName = userMessage.replace('/artist', '').trim();
        if (!artistName) {
          await sendMessage(chatId, "Please provide an artist name. Example: /artist Yo Maps", token);
          return new Response('OK');
        }
        
        await sendAction(chatId, 'typing', token);
        
        const artist = await env.DB.prepare(`
          SELECT id, name, bio, country, genre, total_tracks, total_downloads, views, image_url
          FROM artists 
          WHERE name LIKE ? AND status = 'active'
        `).bind(`%${artistName}%`).first();
        
        if (!artist) {
          await sendMessage(chatId, `❌ Artist "${artistName}" not found in library.`, token);
          return new Response('OK');
        }
        
        // Get artist's top songs
        const songs = await env.DB.prepare(`
          SELECT s.id, s.title, s.duration, s.download_count
          FROM songs s
          WHERE s.artist_id = ?
          ORDER BY s.download_count DESC
          LIMIT 5
        `).bind(artist.id).all();
        
        let response = `🎤 *${artist.name}*\n\n`;
        if (artist.bio) response += `${artist.bio.substring(0, 200)}...\n\n`;
        response += `📊 *Stats:*\n`;
        response += `🇿🇲 ${artist.country || 'Zambia'}\n`;
        response += `🎸 ${artist.genre || 'Various'}\n`;
        response += `🎵 ${artist.total_tracks || 0} tracks\n`;
        response += `⭐ ${artist.total_downloads || 0} total downloads\n\n`;
        
        if (songs.results.length > 0) {
          response += `*Top Tracks:*\n`;
          songs.results.forEach((song, i) => {
            response += `${i+1}. *${song.title}* — ${song.download_count || 0} downloads\n`;
          });
          response += `\nSend /song [title] to download.`;
        } else {
          response += `No tracks found for this artist yet.`;
        }
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== GENRE SEARCH ==========
      
      if (userMessage.startsWith('/genre')) {
        const genre = userMessage.replace('/genre', '').trim().toLowerCase();
        if (!genre) {
          await sendMessage(chatId, "Please provide a genre. Example: /genre Gospel", token);
          return new Response('OK');
        }
        
        await sendAction(chatId, 'typing', token);
        
        const artists = await env.DB.prepare(`
          SELECT name, genre, total_downloads, total_tracks
          FROM artists 
          WHERE LOWER(genre) LIKE ? AND status = 'active'
          ORDER BY total_downloads DESC
          LIMIT 10
        `).bind(`%${genre}%`).all();
        
        if (artists.results.length === 0) {
          await sendMessage(chatId, `❌ No artists found in genre "${genre}".`, token);
          return new Response('OK');
        }
        
        let response = `🎵 *${genre.toUpperCase()} Artists*\n\n`;
        artists.results.forEach((a, i) => {
          response += `${i+1}. *${a.name}* — ${a.total_tracks || 0} tracks, ${a.total_downloads || 0} downloads\n`;
        });
        response += `\nUse /artist [name] to see more.`;
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== TRENDING / POPULAR ==========
      
      if (userMessage === '/trending') {
        await sendAction(chatId, 'typing', token);
        
        const trending = await env.DB.prepare(`
          SELECT s.id, s.title, a.name as artist, s.download_count
          FROM songs s
          JOIN artists a ON s.artist_id = a.id
          WHERE s.status = 'active'
          ORDER BY s.download_count DESC
          LIMIT 10
        `).all();
        
        if (trending.results.length === 0) {
          await sendMessage(chatId, "No trending songs found.", token);
          return new Response('OK');
        }
        
        let response = "🔥 *Trending Songs*\n\n";
        trending.results.forEach((song, i) => {
          response += `${i+1}. *${song.title}* — ${song.artist}\n`;
          response += `   ⭐ ${song.download_count || 0} downloads\n`;
        });
        response += `\nSend /song [title] to download.`;
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== FEATURED ARTISTS ==========
      
      if (userMessage === '/featured') {
        await sendAction(chatId, 'typing', token);
        
        const featured = await env.DB.prepare(`
          SELECT name, genre, total_downloads, image_url
          FROM artists 
          WHERE is_featured = 1 AND status = 'active'
          ORDER BY total_downloads DESC
          LIMIT 10
        `).all();
        
        if (featured.results.length === 0) {
          await sendMessage(chatId, "No featured artists found.", token);
          return new Response('OK');
        }
        
        let response = "⭐ *Featured Artists*\n\n";
        featured.results.forEach((a, i) => {
          response += `${i+1}. *${a.name}* — ${a.genre || 'Various'}\n`;
          response += `   ⭐ ${a.total_downloads || 0} downloads\n`;
        });
        response += `\nUse /artist [name] to see more.`;
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== ZAMBIAN LEGENDS ==========
      
      if (userMessage === '/legends') {
        await sendAction(chatId, 'typing', token);
        
        const legends = await env.DB.prepare(`
          SELECT name, genre, total_downloads, bio
          FROM artists 
          WHERE is_zambian_legend = 1 AND status = 'active'
          ORDER BY total_downloads DESC
        `).all();
        
        if (legends.results.length === 0) {
          await sendMessage(chatId, "No legends found.", token);
          return new Response('OK');
        }
        
        let response = "👑 *Zambian Music Legends*\n\n";
        legends.results.forEach((a, i) => {
          response += `${i+1}. *${a.name}* — ${a.genre || 'Various'}\n`;
          response += `   ⭐ ${a.total_downloads || 0} downloads\n`;
        });
        response += `\nUse /artist [name] to learn more.`;
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== NATURAL LANGUAGE SEARCH (AI) ==========
      
      // Check if it's a music-related query
      const isMusicQuery = !userMessage.startsWith('/');
      
      if (isMusicQuery) {
        await sendAction(chatId, 'typing', token);
        
        // Send thinking message
        const thinking = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "🔍 Searching...",
            reply_to_message_id: messageId
          })
        });
        const thinkingData = await thinking.json();
        const thinkingMsgId = thinkingData.result.message_id;
        
        // Use AI to understand the query
        const aiResponse = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            messages: [
              { 
                role: "system", 
                content: `Extract artist or song name from the user's message. Return JSON only.
                Example: {"type":"artist","name":"Yo Maps"}
                Example: {"type":"song","name":"Ndipe Mwe","artist":"Pompi"}
                If unclear, return {"type":"unknown"}` 
              },
              { role: "user", content: userMessage }
            ]
          }
        );
        
        let parsed;
        try {
          parsed = JSON.parse(aiResponse.response);
        } catch(e) {
          parsed = { type: "unknown" };
        }
        
        let resultText = "";
        
        if (parsed.type === "artist" && parsed.name) {
          // Search for artist
          const artist = await env.DB.prepare(`
            SELECT name, genre, total_tracks, total_downloads
            FROM artists 
            WHERE name LIKE ? AND status = 'active'
          `).bind(`%${parsed.name}%`).first();
          
          if (artist) {
            resultText = `🎤 *${artist.name}*\n\n`;
            resultText += `🎸 ${artist.genre || 'Various'}\n`;
            resultText += `🎵 ${artist.total_tracks || 0} tracks\n`;
            resultText += `⭐ ${artist.total_downloads || 0} downloads\n\n`;
            resultText += `Use /artist ${artist.name} for more details.`;
          } else {
            resultText = `❌ Artist "${parsed.name}" not found in library.`;
          }
          
        } else if (parsed.type === "song" && parsed.name) {
          // Search for song
          const song = await env.DB.prepare(`
            SELECT s.title, a.name as artist, s.download_count
            FROM songs s
            JOIN artists a ON s.artist_id = a.id
            WHERE s.title LIKE ?
            ORDER BY s.download_count DESC
            LIMIT 1
          `).bind(`%${parsed.name}%`).first();
          
          if (song) {
            resultText = `🎵 *${song.title}* — ${song.artist}\n`;
            resultText += `⭐ ${song.download_count || 0} downloads\n\n`;
            resultText += `Check our website to download!`;
          } else {
            resultText = `❌ Song "${parsed.name}" not found in library.`;
          }
          
        } else {
          resultText = `🎵 *ZEDTOP VIBES*\n\n` +
                      `Try:\n` +
                      `• Send an artist name (e.g., "Yo Maps")\n` +
                      `• /artist [name]\n` +
                      `• /genre [genre]\n` +
                      `• /trending\n` +
                      `• /featured`;
        }
        
        // Edit thinking message with result
        await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: thinkingMsgId,
            text: resultText,
            parse_mode: 'Markdown'
          })
        });
        
        return new Response('OK');
      }
      
      // ========== DEFAULT: UNKNOWN COMMAND ==========
      
      await sendMessage(chatId, 
        `❌ Unknown command. Try /help to see available commands.`, 
        token
      );
      
      return new Response('OK');
    }
    
    return new Response('ZEDTOP VIBES Bot is running! Send /start to begin.');
  }
};

// ========== HELPER FUNCTIONS ==========

async function sendAction(chatId, action, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: action })
  });
}

async function sendMessage(chatId, text, token, options = {}) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: options.parse_mode || 'Markdown'
  };
  
  if (options.reply_to_message_id) {
    payload.reply_to_message_id = options.reply_to_message_id;
  }
  
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

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