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
				"Send me any file to upload to Cloudflare R2.\n\n" +
				"<b>Commands:</b>\n" +
				"/search <keyword> - Search files & download\n" +
				"/list - Show last 10 uploaded files\n" +
				"/help - Show this message", 
				env.TELEGRAM_BOT_TOKEN
			);
			return;
		}
		
		if (text.startsWith("/help")) {
			await sendMessage(chatId, 
				"📚 <b>Help</b>\n" +
				"• <b>Upload:</b> Send any file (Doc, Photo, Video).\n" +
				"• <b>Search:</b> /search song → Click result to download.\n" +
				"• <b>Delete:</b> Admins only: /delete <key>", 
				env.TELEGRAM_BOT_TOKEN
			);
			return;
		}
		if (text.startsWith("/search")) {
			const query = text.replace("/search", "").trim();
			if (!query) {
				await sendMessage(chatId, "Usage: /search <keyword>", env.TELEGRAM_BOT_TOKEN);
				return;
			}
			await handleSearchCommand(chatId, query, env);
			return;
		}

		if (text.startsWith("/list")) {
			await handleListCommand(chatId, env);
			return;
		}

		if (text.startsWith("/delete")) {
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

// --- Feature: Smart Search ---
async function handleSearchCommand(chatId, query, env) {
	try {
		await sendChatAction(chatId, "typing", env.TELEGRAM_BOT_TOKEN);
		const statusMsg = await sendMessage(chatId, `🔍 Searching for "${query}"...`, env.TELEGRAM_BOT_TOKEN);

		const listed = await env.MY_BUCKET.list({ limit: 50 });
		const lowerQuery = query.toLowerCase();
		const matches = listed.objects.filter(obj => obj.key.toLowerCase().includes(lowerQuery));

		if (matches.length === 0) {
			await editMessage(chatId, statusMsg.result.message_id, `❌ No files found for "${query}".`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		if (matches.length > 3) {
			let text = `🔍 Found ${matches.length} files. Please be more specific.\n\nTop 5:\n`;
			matches.slice(0, 5).forEach(obj => { text += `• <code>${obj.key}</code>\n`; });
			await editMessage(chatId, statusMsg.result.message_id, text, env.TELEGRAM_BOT_TOKEN);
		} else {
			await editMessage(chatId, statusMsg.result.message_id, `✅ Sending ${matches.length} file(s)...`, env.TELEGRAM_BOT_TOKEN);
			for (const obj of matches) {
				await sendFileFromR2(chatId, obj.key, env);
			}
		}
	} catch (error) {
		console.error(error);
		await sendMessage(chatId, `❌ Search Error: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: Send Actual File from R2 ---
async function sendFileFromR2(chatId, key, env) {
	try {
		// Cool Animation: "Sending file..." status in chat header
		await sendChatAction(chatId, "upload_document", env.TELEGRAM_BOT_TOKEN);

		const object = await env.MY_BUCKET.get(key);
		if (object === null) {
			await sendMessage(chatId, `❌ File not found: ${key}`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		if (object.size && object.size > 50 * 1024 * 1024) {
			await sendMessage(chatId, `⚠️ File too large (${formatBytes(object.size)}).`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		const fileBuffer = await object.arrayBuffer();
		const contentType = object.httpMetadata?.contentType || "application/octet-stream";
		const fileName = key.split('_').slice(2).join('_') || key;

		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append("document", new Blob([fileBuffer], { type: contentType }), fileName);
		formData.append("caption", `📄 <b>${fileName}</b>`);
		formData.append("parse_mode", "HTML");

		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
			method: "POST",
			body: formData
		});

	} catch (error) {
		await sendMessage(chatId, `⚠️ Failed to send ${key}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: File Upload (With Progress Animation) ---
async function handleFileUpload(chatId, fileObj, env) {
	try {
		// Start with an animated status
		await sendChatAction(chatId, "upload_document", env.TELEGRAM_BOT_TOKEN);
		const statusMsg = await sendMessage(chatId, "⏳ <b>Preparing Upload...</b>\n[▒▒▒▒▒▒▒▒▒▒] 0%", env.TELEGRAM_BOT_TOKEN);

		const fileInfo = await getTelegramFileInfo(fileObj.file_id, env.TELEGRAM_BOT_TOKEN);
		if (!fileInfo.ok) throw new Error("Telegram API Error");

		// "Animate" the progress bar to 50% after getting info
		await editMessage(chatId, statusMsg.result.message_id, "📡 <b>Downloading from Telegram...</b>\n[█████▒▒▒▒▒] 50%", env.TELEGRAM_BOT_TOKEN);

		const filePath = fileInfo.result.file_path;
		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const mimeType = fileObj.mime_type || "application/octet-stream";
		const fileBuffer = await downloadTelegramFile(filePath, env.TELEGRAM_BOT_TOKEN);

		// "Animate" the progress bar to 80% before R2 push
		await editMessage(chatId, statusMsg.result.message_id, "☁️ <b>Pushing to Cloudflare R2...</b>\n[████████▒▒] 80%", env.TELEGRAM_BOT_TOKEN);

		const r2Key = `${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`;
		await env.MY_BUCKET.put(r2Key, fileBuffer, { httpMeta: { contentType: mimeType } });

		const finalMsg = `✅ <b>Upload Successful!</b>\n\n📄 <b>Name:</b> ${fileName}\n📦 <b>Size:</b> ${formatBytes(fileObj.file_size)}\n🔑 <b>Key:</b> \`${r2Key}\``;
		
		await editMessage(chatId, statusMsg.result.message_id, finalMsg, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		await sendMessage(chatId, `❌ Upload Failed: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- New Helper: Send Chat Actions (Animations) ---
async function sendChatAction(chatId, action, botToken) {
	await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, action: action })
	});
}

// --- New Helper: Edit Message (For Progress Bars) ---
async function editMessage(chatId, messageId, text, botToken) {
	const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			chat_id: chatId,
			message_id: messageId,
			text: text,
			parse_mode: "HTML"
		})
	});
	return await res.json();
}

// --- Original Helpers ---
async function getTelegramFileInfo(fileId, botToken) {
	const res = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
	return await res.json();
}

async function downloadTelegramFile(filePath, botToken) {
	const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
	return await res.arrayBuffer();
}

async function sendMessage(chatId, text, botToken) {
	const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
	});
	return await res.json();
}

function formatBytes(bytes, decimals = 2) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}
