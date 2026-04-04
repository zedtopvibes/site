export default {
	async fetch(request, env, ctx) {
		if (request.method === "POST") {
			try {
				const update = await request.json();
				
				// Process in background so we can reply to Telegram quickly
				ctx.waitUntil(processUpdate(update, env));
				
				return new Response("OK", { status: 200 });
			} catch (error) {
				console.error("Webhook Error:", error);
				return new Response("Internal Error", { status: 500 });
			}
		}

		return new Response("Bot is running! Send a file to test.", { 
			status: 200,
			headers: { "content-type": "text/plain" }
		});
	},
};

async function processUpdate(update, env) {
	if (!update.message) return;

	const message = update.message;
	const chatId = message.chat.id;

	// 1. Detect File (Priority: Document > Video > Audio > Photo)
	const fileObj = message.document || 
					message.video || 
					message.audio || 
					(message.photo ? message.photo[message.photo.length - 1] : null);

	if (!fileObj) return; // No file found

	try {
		await sendMessage(chatId, "⏳ Uploading to cloud...", env.TELEGRAM_BOT_TOKEN);

		// 2. Get File Path from Telegram
		const fileInfo = await getTelegramFileInfo(fileObj.file_id, env.TELEGRAM_BOT_TOKEN);
		if (!fileInfo.ok) throw new Error("Failed to get file info");

		const filePath = fileInfo.result.file_path;
		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const mimeType = fileObj.mime_type || "application/octet-stream";

		// 3. Download File as ArrayBuffer
		const fileBuffer = await downloadTelegramFile(filePath, env.TELEGRAM_BOT_TOKEN);
		// 4. Upload to R2
		// Create a unique key to prevent overwrites
		const r2Key = `${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`;
		
		await env.MY_BUCKET.put(r2Key, fileBuffer, {
			httpMetadata: {
				contentType: mimeType,
			},
		});

		// 5. Send Success Message
		// Note: If you have public access enabled on R2, you can construct a URL here.
		// For now, we just confirm the upload and provide the internal key.
		const msg = `✅ <b>Upload Successful!</b>\n\n📄 Name: ${fileName}\n📦 Size: ${formatBytes(fileObj.file_size)}\n🔑 R2 Key: ${r2Key}`;
		
		await sendMessage(chatId, msg, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		console.error("Upload Error:", error);
		await sendMessage(chatId, `❌ Error: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Helper Functions ---

async function getTelegramFileInfo(fileId, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
	const res = await fetch(url);
	return await res.json();
}

async function downloadTelegramFile(filePath, botToken) {
	const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
	const res = await fetch(url);
	
	if (!res.ok) {
		throw new Error(`Download failed: ${res.statusText}`);
	}
	
	return await res.arrayBuffer();
}

async function sendMessage(chatId, text, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({			chat_id: chatId,
			text: text,
			parse_mode: "HTML"
		})
	});
}

function formatBytes(bytes, decimals = 2) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}