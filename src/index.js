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
      
      // ========== TRACK SEARCH ==========
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
          await sendMessage(chatId, `❌ Track "${trackTitle}" not found.`, token);
          return new Response('OK');
        }
        
        const file = await env.AUDIO.get(track.r2_key);
        
        if (!file) {
          await sendMessage(chatId, `❌ File not found: ${track.r2_key}`, token);
          return new Response('OK');
        }
        
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
      
      // ========== ARTIST SEARCH ==========
      let artistName = null;
      
      if (userMessage.startsWith('/artist ')) {
        artistName = userMessage.replace('/artist ', '').trim();
      } else if (!userMessage.startsWith('/')) {
        artistName = userMessage.trim();
      }
      
      if (artistName) {
        const artist = await env.DB.prepare(`
          SELECT id, name, genre, country, image_url
          FROM artists 
          WHERE name LIKE ? AND status = 'published'
          LIMIT 1
        `).bind(`%${artistName}%`).first();
        
        if (!artist) {
          await sendMessage(chatId, `❌ Artist "${artistName}" not found.`, token);
          return new Response('OK');
        }
        
        const tracks = await env.DB.prepare(`
          SELECT t.id, t.title
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          WHERE ta.artist_id = ? 
            AND ta.is_primary = 1
            AND t.status = 'published'
          ORDER BY t.id DESC
          LIMIT 20
        `).bind(artist.id).all();
        
        let responseText = `🎤 *${artist.name}*\n\n`;
        if (artist.genre) responseText += `🎸 Genre: ${artist.genre}\n`;
        if (artist.country) responseText += `🇿🇲 Country: ${artist.country}\n\n`;
        
        if (tracks.results.length === 0) {
          responseText += `No tracks found.`;
        } else {
          responseText += `*Tracks (${tracks.results.length}):*\n\n`;
          tracks.results.forEach((track, i) => {
            responseText += `${i+1}. *${track.title}*\n`;
          });
          responseText += `\nUse /track "title" to download.`;
        }
        
        // Send artist image if available
        if (artist.image_url) {
          const imageFile = await env.AUDIO.get(artist.image_url);
          
          if (imageFile) {
            // Send photo with caption
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('photo', imageFile.body);
            formData.append('caption', responseText);
            formData.append('parse_mode', 'Markdown');
            
            await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: 'POST',
              body: formData
            });
          } else {
            // Image not found in R2, send text only
            await sendMessage(chatId, responseText, token);
          }
        } else {
          // No image URL, send text only
          await sendMessage(chatId, responseText, token);
        }
        
        return new Response('OK');
      }
      
      // Default response
      await sendMessage(chatId, `Send an artist name (e.g., "1006Xv") or:\n/artist NAME\n/track TITLE`, token);
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