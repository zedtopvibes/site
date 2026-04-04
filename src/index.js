export default {
	async fetch(request, env, ctx) {
		// 1. Handle Telegram Webhook (POST)
		if (request.method === "POST") {
			try {
				const update = await request.json();
				
				// Check if it's a message and contains text
				if (update.message && update.message.text) {
					const chatId = update.message.chat.id;
					const text = update.message.text;

					// Simple logic: If user says "Ping", bot says "Pong"
					if (text.toLowerCase() === "ping") {
						// Use env.TELEGRAM_BOT_TOKEN here
						await sendMessage(chatId, "Pong! 🏓", env.TELEGRAM_BOT_TOKEN);
					} else {
						// Optional: Echo back anything else to verify connectivity
						await sendMessage(chatId, `Received: ${text}`, env.TELEGRAM_BOT_TOKEN);
					}
				}
				
				return new Response("OK", { status: 200 });
			} catch (error) {
				console.error("Error processing update:", error);
				return new Response("Internal Error", { status: 500 });
			}
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
	
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			text: text
		})
	});

	if (!response.ok) {
		throw new Error(`Telegram API Error: ${response.statusText}`);
	}
}