export default {
	async fetch(request, env, ctx) {
		if (request.method === "POST") {
			try {
				const update = await request.json();
				ctx.waitUntil(processUpdate(update, env));
				return new Response("OK", { status: 200 });
			} catch (error) {
				console.error("Webhook Error:", error);
				return new Response("Internal Error", { status: 500 });
			}
		}
		return new Response("Bot is running!", { status: 200 });
	},
};

async function processUpdate(update, env) {
	if (!update.message) return;

	const message = update.message;
	const chatId = message.chat.id;
	const userId = message.from?.id;
	const text = message.text;

	// 1. Handle Commands
	if (text) {
		if (text.startsWith("/start")) {
			await sendMessage(chatId, 
				"👋 <b>Welcome to Aitestzm Bot!</b>\n\n" +
				"Send me any file (Document, Photo, Video, Audio) and I will upload it to Cloudflare R2.\n\n" +
				"<b>Commands:</b>\n" +
				"/list - Show last 10 uploaded files\n" +
				"/help - Show this message", 
				env.TELEGRAM_BOT_TOKEN
			);
			return;
		}
		
		if (text.startsWith("/help")) {
			await sendMessage(chatId, 
				"📚 <b>Help</b>\n" +
				"1. Send a file to upload.\n" +
				"2. Use /list to see recent uploads.\n" +
				"3. Admins can use /delete <key> to remove files.", 
				env.TELEGRAM_BOT_TOKEN
			);
			return;
		}

		if (text.startsWith("/list")) {			await handleListCommand(chatId, env);
			return;
		}

		if (text.startsWith("/delete")) {
			// Admin Only Check
			if (String(userId) !== env.ADMIN_ID) {
				await sendMessage(chatId, "🚫 Admins only.", env.TELEGRAM_BOT_TOKEN);
				return;
			}
			const key = text.split(" ")[1];
			if (!key) {
				await sendMessage(chatId, "Usage: /delete <file_key>", env.TELEGRAM_BOT_TOKEN);
				return;
			}
			await handleDeleteCommand(chatId, key, env);
			return;
		}
	}

	// 2. Handle File Uploads
	const fileObj = message.document || 
					message.video || 
					message.audio || 
					(message.photo ? message.photo[message.photo.length - 1] : null);

	if (fileObj) {
		await handleFileUpload(chatId, fileObj, env);
	}
}

// --- Feature: File Upload ---
async function handleFileUpload(chatId, fileObj, env) {
	try {
		await sendMessage(chatId, "⏳ Uploading...", env.TELEGRAM_BOT_TOKEN);

		const fileInfo = await getTelegramFileInfo(fileObj.file_id, env.TELEGRAM_BOT_TOKEN);
		if (!fileInfo.ok) throw new Error("Telegram API Error");

		const filePath = fileInfo.result.file_path;
		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const mimeType = fileObj.mime_type || "application/octet-stream";

		const fileBuffer = await downloadTelegramFile(filePath, env.TELEGRAM_BOT_TOKEN);

		// Generate Key
		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(7);
		const r2Key = `${timestamp}_${randomStr}_${fileName}`;
		// Upload to R2
		await env.MY_BUCKET.put(r2Key, fileBuffer, {
			httpMeta {
				contentType: mimeType,
			},
		});

		// Construct Public URL (Replace with your actual R2 public domain)
		// If you haven't set up a custom domain, use the default r2.dev domain if enabled
		const publicDomain = env.PUBLIC_R2_DOMAIN || "https://pub-xxxx.r2.dev"; // Set PUBLIC_R2_DOMAIN in wrangler.toml vars if you have one
		const publicUrl = `${publicDomain}/${r2Key}`;

		const msg = `✅ <b>Upload Successful!</b>\n\n` +
					`📄 <b>Name:</b> ${fileName}\n` +
					`📦 <b>Size:</b> ${formatBytes(fileObj.file_size)}\n` +
					`🔗 <b>Link:</b> <a href="${publicUrl}">Download File</a>\n` +
					`🔑 <b>Key:</b> \`${r2Key}\``;

		await sendMessage(chatId, msg, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		console.error(error);
		await sendMessage(chatId, `❌ Upload Failed: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: List Files ---
async function handleListCommand(chatId, env) {
	try {
		// List objects in R2 (limited to 10 for simplicity)
		const listed = await env.MY_BUCKET.list({ limit: 10 });
		
		if (listed.objects.length === 0) {
			await sendMessage(chatId, "📂 Bucket is empty.", env.TELEGRAM_BOT_TOKEN);
			return;
		}

		let text = "📂 <b>Recent Files:</b>\n\n";
		listed.objects.forEach((obj, index) => {
			// Truncate long names
			const displayName = obj.key.length > 30 ? obj.key.substring(0, 30) + "..." : obj.key;
			text += `${index + 1}. <code>${obj.key}</code> (${formatBytes(obj.size)})\n`;
		});

		// Telegram message limit is 4096 chars, this should be safe for 10 items
		await sendMessage(chatId, text, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		await sendMessage(chatId, `❌ Error listing files: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}}

// --- Feature: Delete File (Admin) ---
async function handleDeleteCommand(chatId, key, env) {
	try {
		await env.MY_BUCKET.delete(key);
		await sendMessage(chatId, `🗑️ Deleted: <code>${key}</code>`, env.TELEGRAM_BOT_TOKEN);
	} catch (error) {
		await sendMessage(chatId, `❌ Delete Failed: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Helpers ---

async function getTelegramFileInfo(fileId, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
	const res = await fetch(url);
	return await res.json();
}

async function downloadTelegramFile(filePath, botToken) {
	const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
	return await res.arrayBuffer();
}

async function sendMessage(chatId, text, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
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