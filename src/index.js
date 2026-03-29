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
      const userMessage = message.text;
      const messageId = message.message_id;
      const token = env.TELEGRAM_BOT_TOKEN;
      
      // ========== FAST COMMANDS ==========
      
      if (userMessage === '/start') {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `🎵 *Welcome to ZEDTOP VIBES Bot!* 🇿🇲\n\n` +
                  `Send an artist name or song title to get started.\n\n` +
                  `📋 *Commands:*\n` +
                  `/artist [name] — Artist info\n` +
                  `/track [title] — Get a song\n` +
                  `/genre [genre] — Browse by genre\n` +
                  `/testdb — Test database\n` +
                  `/help — All commands`,
            parse_mode: 'Markdown',
            reply_to_message_id: messageId
          })
        });
        return new Response('OK');
      }
      
      if (userMessage === '/help') {
        const helpText = `🎵 *ZEDTOP VIBES Bot Commands*
        
*🎤 Music:*
• Send any artist name (e.g., "Kanina")
• Send any song title (e.g., "Hello Rebecca")
• /artist [name] — Artist details
• /track [title] — Get a song
• /genre [genre] — Browse by genre

*📋 Test Commands:*
/testdb — Check database connection

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
      
      // ========== TEST DATABASE ==========
      
      if (userMessage === '/testdb') {
        await sendAction(chatId, 'typing', token);
        
        try {
          // Get published tracks count
          const trackCount = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM tracks 
            WHERE status = 'published' AND deleted_at IS NULL
          `).first();
          
          // Get published artists count
          const artistCount = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM artists 
            WHERE status = 'published' AND deleted_at IS NULL
          `).first();
          
          // Get sample tracks with artists
          const sampleTracks = await env.DB.prepare(`
            SELECT t.id, t.title, a.name as artist_name
            FROM tracks t
            JOIN track_artists ta ON t.id = ta.track_id
            JOIN artists a ON ta.artist_id = a.id
            WHERE ta.is_primary = 1 
              AND t.status = 'published' 
              AND t.deleted_at IS NULL
            LIMIT 5
          `).all();
          
          let response = `📊 *Database Status*\n\n`;
          response += `✅ Connected to D1\n`;
          response += `📀 Tracks: ${trackCount?.count || 0}\n`;
          response += `🎤 Artists: ${artistCount?.count || 0}\n\n`;
          
          if (sampleTracks.results.length > 0) {
            response += `*Sample Tracks:*\n`;
            sampleTracks.results.forEach((t, i) => {
              response += `${i+1}. ${t.title} — ${t.artist_name}\n`;
            });
          }
          
          await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
          
        } catch (error) {
          await sendMessage(chatId, `❌ Database error: ${error.message}`, token);
        }
        
        return new Response('OK');
      }
      
      // ========== ARTIST SEARCH ==========
      
      if (userMessage.startsWith('/artist')) {
        const artistName = userMessage.replace('/artist', '').trim();
        if (!artistName) {
          await sendMessage(chatId, "Please provide an artist name. Example: /artist Kanina", token);
          return new Response('OK');
        }
        
        await sendAction(chatId, 'typing', token);
        
        const artist = await env.DB.prepare(`
          SELECT id, name, bio, country, genre, image_url
          FROM artists 
          WHERE name LIKE ? AND status = 'published' AND deleted_at IS NULL
        `).bind(`%${artistName}%`).first();
        
        if (!artist) {
          await sendMessage(chatId, `❌ Artist "${artistName}" not found.`, token);
          return new Response('OK');
        }
        
        // Get artist's tracks via track_artists
        const tracks = await env.DB.prepare(`
          SELECT t.id, t.title, t.duration, t.genre
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          WHERE ta.artist_id = ? 
            AND ta.is_primary = 1
            AND t.status = 'published' 
            AND t.deleted_at IS NULL
          ORDER BY t.id DESC
          LIMIT 10
        `).bind(artist.id).all();
        
        let response = `🎤 *${artist.name}*\n\n`;
        if (artist.bio) response += `${artist.bio.substring(0, 200)}...\n\n`;
        if (artist.genre) response += `🎸 ${artist.genre}\n`;
        if (artist.country) response += `🇿🇲 ${artist.country}\n\n`;
        
        if (tracks.results.length > 0) {
          response += `*Tracks:*\n`;
          tracks.results.forEach((track, i) => {
            response += `${i+1}. *${track.title}*\n`;
          });
          response += `\nUse /track [title] to download.`;
        } else {
          response += `No tracks found for this artist yet.`;
        }
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== TRACK SEARCH & DOWNLOAD ==========
      
      if (userMessage.startsWith('/track')) {
        const trackTitle = userMessage.replace('/track', '').trim();
        if (!trackTitle) {
          await sendMessage(chatId, "Please provide a track name. Example: /track Hello Rebecca", token);
          return new Response('OK');
        }
        
        await sendAction(chatId, 'typing', token);
        
        // Search for track with primary artist via track_artists
        const track = await env.DB.prepare(`
          SELECT t.id, t.title, t.r2_key, t.duration, t.genre, 
                 t.artwork_url, a.name as artist_name
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          JOIN artists a ON ta.artist_id = a.id
          WHERE t.title LIKE ? 
            AND ta.is_primary = 1
            AND t.status = 'published' 
            AND t.deleted_at IS NULL
          ORDER BY t.id DESC
          LIMIT 1
        `).bind(`%${trackTitle}%`).first();
        
        if (!track) {
          await sendMessage(chatId, `❌ Track "${trackTitle}" not found.`, token);
          return new Response('OK');
        }
        
        // Send thinking message
        const thinking = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: "📤 Sending your track...",
            reply_to_message_id: messageId
          })
        });
        const thinkingData = await thinking.json();
        const thinkingMsgId = thinkingData.result.message_id;
        
        // Get file from R2
        const file = await env.AUDIO.get(track.r2_key);
        
        if (!file) {
          await editMessage(chatId, thinkingMsgId, "❌ File not found. Please report to admin.", token);
          return new Response('OK');
        }
        
        // Prepare audio for Telegram
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('audio', file.body, {
          filename: `${track.title} - ${track.artist_name}.mp3`,
          contentType: 'audio/mpeg'
        });
        formData.append('title', track.title);
        formData.append('performer', track.artist_name);
        if (track.duration) formData.append('duration', track.duration);
        
        let caption = `🎵 *${track.title}* — ${track.artist_name}`;
        if (track.genre) caption += `\n🏷️ Genre: ${track.genre}`;
        if (track.duration) caption += `\n⏱️ Duration: ${formatDuration(track.duration)}`;
        formData.append('caption', caption);
        formData.append('parse_mode', 'Markdown');
        
        await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
          method: 'POST',
          body: formData
        });
        
        await deleteMessage(chatId, thinkingMsgId, token);
        return new Response('OK');
      }
      
      // ========== GENRE SEARCH ==========
      
      if (userMessage.startsWith('/genre')) {
        const genre = userMessage.replace('/genre', '').trim().toLowerCase();
        if (!genre) {
          await sendMessage(chatId, "Please provide a genre. Example: /genre Hip-Hop", token);
          return new Response('OK');
        }
        
        await sendAction(chatId, 'typing', token);
        
        const tracks = await env.DB.prepare(`
          SELECT t.id, t.title, a.name as artist_name
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          JOIN artists a ON ta.artist_id = a.id
          WHERE LOWER(t.genre) LIKE ? 
            AND ta.is_primary = 1
            AND t.status = 'published' 
            AND t.deleted_at IS NULL
          ORDER BY t.id DESC
          LIMIT 15
        `).bind(`%${genre}%`).all();
        
        if (tracks.results.length === 0) {
          await sendMessage(chatId, `❌ No tracks found in genre "${genre}".`, token);
          return new Response('OK');
        }
        
        let response = `🎵 *${genre.toUpperCase()} TRACKS*\n\n`;
        tracks.results.forEach((track, i) => {
          response += `${i+1}. *${track.title}* — ${track.artist_name}\n`;
        });
        response += `\nUse /track [title] to download.`;
        
        await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
        return new Response('OK');
      }
      
      // ========== NATURAL LANGUAGE SEARCH ==========
      
      if (!userMessage.startsWith('/')) {
        await sendAction(chatId, 'typing', token);
        
        // First, try direct track search
        let track = await env.DB.prepare(`
          SELECT t.id, t.title, t.r2_key, t.duration, t.genre, a.name as artist_name
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          JOIN artists a ON ta.artist_id = a.id
          WHERE t.title LIKE ? 
            AND ta.is_primary = 1
            AND t.status = 'published' 
            AND t.deleted_at IS NULL
          LIMIT 1
        `).bind(`%${userMessage}%`).first();
        
        if (track) {
          // Send the track
          const thinking = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            body: JSON.stringify({
              chat_id: chatId,
              text: "🎵 Found! Sending...",
              reply_to_message_id: messageId
            })
          });
          const thinkingData = await thinking.json();
          const thinkingMsgId = thinkingData.result.message_id;
          
          const file = await env.AUDIO.get(track.r2_key);
          
          if (file) {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('audio', file.body, {
              filename: `${track.title} - ${track.artist_name}.mp3`,
              contentType: 'audio/mpeg'
            });
            formData.append('title', track.title);
            formData.append('performer', track.artist_name);
            if (track.duration) formData.append('duration', track.duration);
            
            let caption = `🎵 *${track.title}* — ${track.artist_name}`;
            if (track.genre) caption += `\n🏷️ Genre: ${track.genre}`;
            formData.append('caption', caption);
            formData.append('parse_mode', 'Markdown');
            
            await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
              method: 'POST',
              body: formData
            });
            
            await deleteMessage(chatId, thinkingMsgId, token);
          }
          return new Response('OK');
        }
        
        // If no track, try artist search
        const artist = await env.DB.prepare(`
          SELECT id, name, genre
          FROM artists 
          WHERE name LIKE ? AND status = 'published' AND deleted_at IS NULL
          LIMIT 1
        `).bind(`%${userMessage}%`).first();
        
        if (artist) {
          const tracks = await env.DB.prepare(`
            SELECT t.id, t.title
            FROM tracks t
            JOIN track_artists ta ON t.id = ta.track_id
            WHERE ta.artist_id = ? 
              AND ta.is_primary = 1
              AND t.status = 'published' 
              AND t.deleted_at IS NULL
            LIMIT 10
          `).bind(artist.id).all();
          
          let response = `🎤 *${artist.name}*\n\n`;
          if (tracks.results.length > 0) {
            response += `*Tracks:*\n`;
            tracks.results.forEach((t, i) => {
              response += `${i+1}. *${t.title}*\n`;
            });
            response += `\nUse /track [title] to download.`;
          } else {
            response += `No tracks found.`;
          }
          
          await sendMessage(chatId, response, token, { parse_mode: 'Markdown' });
          return new Response('OK');
        }
        
        // No matches
        await sendMessage(chatId, 
          `🎵 *ZEDTOP VIBES*\n\n` +
          `I couldn't find "${userMessage}" in the library.\n\n` +
          `Try:\n` +
          `• /artist [name]\n` +
          `• /track [title]\n` +
          `• /genre [genre]`,
          token,
          { parse_mode: 'Markdown' }
        );
        
        return new Response('OK');
      }
      
      await sendMessage(chatId, `❌ Unknown command. Try /help.`, token);
      return new Response('OK');
    }
    
    return new Response('ZEDTOP VIBES Bot is running!');
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

async function deleteMessage(chatId, messageId, token) {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId })
  }).catch(e => console.log('Delete failed:', e));
}

async function editMessage(chatId, messageId, text, token) {
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

function formatDuration(seconds) {
  if (!seconds) return '?';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}