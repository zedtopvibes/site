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
      const token = env.TELEGRAM_BOT_TOKEN;
      
      // ========== ARTIST SEARCH ==========
      if (userMessage.startsWith('/artist ')) {
        const artistName = userMessage.replace('/artist ', '').trim();
        
        const artist = await env.DB.prepare(`
          SELECT id, name FROM artists 
          WHERE name LIKE ? AND status = 'published'
        `).bind(`%${artistName}%`).first();
        
        if (!artist) {
          await sendMessage(chatId, `❌ Artist "${artistName}" not found`, token);
          return new Response('OK');
        }
        
        const tracks = await env.DB.prepare(`
          SELECT t.title FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          WHERE ta.artist_id = ? AND t.status = 'published'
          LIMIT 10
        `).bind(artist.id).all();
        
        let response = `🎤 *${artist.name}*\n\n`;
        tracks.results.forEach((t, i) => {
          response += `${i+1}. ${t.title}\n`;
        });
        response += `\nUse /track "title" to download`;
        
        await sendMessage(chatId, response, token);
        return new Response('OK');
      }
      
      // ========== TRACK SEARCH & DOWNLOAD ==========
      if (userMessage.startsWith('/track ')) {
        const trackTitle = userMessage.replace('/track ', '').trim();
        
        const track = await env.DB.prepare(`
          SELECT t.title, t.r2_key, a.name as artist_name
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          JOIN artists a ON ta.artist_id = a.id
          WHERE t.title LIKE ? AND ta.is_primary = 1
            AND t.status = 'published'
          LIMIT 1
        `).bind(`%${trackTitle}%`).first();
        
        if (!track) {
          await sendMessage(chatId, `❌ Track "${trackTitle}" not found`, token);
          return new Response('OK');
        }
        
        // Get file from R2
        const file = await env.AUDIO.get(track.r2_key);
        
        if (!file) {
          await sendMessage(chatId, `❌ File not found: ${track.r2_key}`, token);
          return new Response('OK');
        }
        
        // Send audio
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('audio', file.body, {
          filename: `${track.title} - ${track.artist_name}.mp3`,
          contentType: 'audio/mpeg'
        });
        formData.append('title', track.title);
        formData.append('performer', track.artist_name);
        
        await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
          method: 'POST',
          body: formData
        });
        
        return new Response('OK');
      }
      
      // ========== NATURAL LANGUAGE ==========
      if (!userMessage.startsWith('/')) {
        // Try track first
        let track = await env.DB.prepare(`
          SELECT t.title, t.r2_key, a.name as artist_name
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          JOIN artists a ON ta.artist_id = a.id
          WHERE t.title LIKE ? AND ta.is_primary = 1
            AND t.status = 'published'
          LIMIT 1
        `).bind(`%${userMessage}%`).first();
        
        if (track) {
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
            await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
              method: 'POST',
              body: formData
            });
          } else {
            await sendMessage(chatId, `❌ File missing: ${track.r2_key}`, token);
          }
          return new Response('OK');
        }
        
        // Try artist
        const artist = await env.DB.prepare(`
          SELECT id, name FROM artists 
          WHERE name LIKE ? AND status = 'published'
          LIMIT 1
        `).bind(`%${userMessage}%`).first();
        
        if (artist) {
          const tracks = await env.DB.prepare(`
            SELECT t.title FROM tracks t
            JOIN track_artists ta ON t.id = ta.track_id
            WHERE ta.artist_id = ? AND t.status = 'published'
            LIMIT 10
          `).bind(artist.id).all();
          
          let response = `🎤 *${artist.name}*\n\n`;
          tracks.results.forEach((t, i) => {
            response += `${i+1}. ${t.title}\n`;
          });
          await sendMessage(chatId, response, token);
        } else {
          await sendMessage(chatId, `❌ No artist or track found for "${userMessage}"`, token);
        }
        
        return new Response('OK');
      }
      
      await sendMessage(chatId, `Send /artist NAME or /track TITLE`, token);
      return new Response('OK');
    }
    
    return new Response('ZEDTOP VIBES Bot');
  }
};

async function sendMessage(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}