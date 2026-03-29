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
      let artistName = null;
      
      if (userMessage.startsWith('/artist ')) {
        artistName = userMessage.replace('/artist ', '').trim();
      } else if (!userMessage.startsWith('/')) {
        artistName = userMessage.trim();
      }
      
      if (artistName) {
        // Search for artist
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
        
        // Get artist's tracks
        const tracks = await env.DB.prepare(`
          SELECT t.id, t.title, t.duration
          FROM tracks t
          JOIN track_artists ta ON t.id = ta.track_id
          WHERE ta.artist_id = ? 
            AND ta.is_primary = 1
            AND t.status = 'published'
          ORDER BY t.id DESC
          LIMIT 20
        `).bind(artist.id).all();
        
        // Build response text
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
          // Try to get image from R2
          const imageFile = await env.AUDIO.get(artist.image_url);
          
          if (imageFile) {
            // Send photo first
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
            // If image not found, just send text
            await sendMessage(chatId, responseText, token);
          }
        } else {
          // No image, just send text
          await sendMessage(chatId, responseText, token);
        }
        
        return new Response('OK');
      }
      
      await sendMessage(chatId, `Send an artist name (e.g., "Kanina") or /artist Kanina`, token);
      return new Response('OK');
    }
    
    return new Response('ZEDTOP VIBES Bot - Artist Search');
  }
};

async function sendMessage(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}