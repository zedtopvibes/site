export default {
	async fetch(request, env, ctx) {
		// 1. Handle Telegram Webhook (POST)
		if (request.method === "POST") {
			const update = await request.json();
			
			// Check if it's a message and contains text
			if (update.message && update.message.text) {
				const chatId = update.message.chat.id;
				const text = update.message.text;

				// Simple logic: If user says "Ping", bot says "Pong"
				if (text.toLowerCase() === "ping") {
					await sendMessage(chatId, "Pong! 🏓", env.BOT_TOKEN);
				} else {
					// Optional: Echo back anything else
					// await sendMessage(chatId, `You said: ${text}`, env.BOT_TOKEN);
				}
			}
			
			return new Response("OK", { status: 200 });
		}

		// 2. Handle GET requests (Health Check)
		return new Response("Bot is running! Send 'Ping' to test.", { 
			status: 200,
			headers: { "content-type": "text/plain" }
		});
	},
};

async function sendMessage(chatId, text, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text: text
		})
	});
}