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

	if (text) {
		if (text.startsWith("/start")) {
			await sendMessage(chatId, "👋 <b>Welcome!</b>\nSend me any file to save it to R2.", env.TELEGRAM_BOT_TOKEN);
			return;
		}
		if (text.startsWith("/search")) {
			const query = text.replace("/search", "").trim();
			if (!query) return sendMessage(chatId, "Usage: /search <keyword>", env.TELEGRAM_BOT_TOKEN);
			await handleSearchCommand(chatId, query, env);
			return;
		}
		if (text.startsWith("/list")) {
			await handleListCommand(chatId, env);
			return;
		}
	}

	const fileObj = message.document || message.video || message.audio || (message.photo ? message.photo[message.photo.length - 1] : null);
	if (fileObj) await handleFileUpload(chatId, fileObj, env);
}

// --- Enhanced Search & Send Animation ---
async function handleSearchCommand(chatId, query, env) {
	try {
		await sendChatAction(chatId, "typing", env.TELEGRAM_BOT_TOKEN);
		const statusMsg = await sendMessage(chatId, `🔍 Searching for <b>"${query}"</b>...`, env.TELEGRAM_BOT_TOKEN);

		const listed = await env.MY_BUCKET.list({ limit: 50 });
		const matches = listed.objects.filter(obj => obj.key.toLowerCase().includes(query.toLowerCase()));

		if (matches.length === 0) {
			await editMessage(chatId, statusMsg.result.message_id, `❌ No files found for "${query}".`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		// Update to "Sending" animation
		await editMessage(chatId, statusMsg.result.message_id, `✅ Found ${matches.length} file(s). Preparing delivery...`, env.TELEGRAM_BOT_TOKEN);

		for (const obj of matches) {
			await sendFileFromR2(chatId, obj.key, env);
		}

		// Delete the "Searching" message after files are sent to keep chat clean
		await deleteMessage(chatId, statusMsg.result.message_id, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		await sendMessage(chatId, `❌ Search Error: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Enhanced Send from R2 (With Animation) ---
async function sendFileFromR2(chatId, key, env) {
	let progressMsg;
	try {
		// 1. Initial visual feedback
		progressMsg = await sendMessage(chatId, `🚀 <b>Retrieving:</b> <code>${key}</code>\n[▒▒▒▒▒▒▒▒▒▒] 0%`, env.TELEGRAM_BOT_TOKEN);
		
		// 2. Fetch from R2
		const object = await env.MY_BUCKET.get(key);
		if (!object) throw new Error("File not found in storage.");

		// 3. Update Progress Bar
		await editMessage(chatId, progressMsg.result.message_id, `📤 <b>Streaming to Telegram...</b>\n[██████▒▒▒▒] 60%`, env.TELEGRAM_BOT_TOKEN);
		await sendChatAction(chatId, "upload_document", env.TELEGRAM_BOT_TOKEN);

		const fileBuffer = await object.arrayBuffer();
		const fileName = key.split('_').slice(2).join('_') || key;

		// 4. Send File
		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append("document", new Blob([fileBuffer]), fileName);
		formData.append("caption", `✅ <b>File Delivered</b>\n📄 <code>${fileName}</code>`);
		formData.append("parse_mode", "HTML");

		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
			method: "POST",
			body: formData
		});

		// 5. Clean up progress message
		await deleteMessage(chatId, progressMsg.result.message_id, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		if (progressMsg) await editMessage(chatId, progressMsg.result.message_id, `⚠️ Failed to send: ${key}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Enhanced Upload (With Animation) ---
async function handleFileUpload(chatId, fileObj, env) {
	try {
		const statusMsg = await sendMessage(chatId, "📥 <b>Starting Upload...</b>\n[▒▒▒▒▒▒▒▒▒▒] 0%", env.TELEGRAM_BOT_TOKEN);

		const fileInfo = await getTelegramFileInfo(fileObj.file_id, env.TELEGRAM_BOT_TOKEN);
		await editMessage(chatId, statusMsg.result.message_id, "📡 <b>Downloading from Telegram...</b>\n[████▒▒▒▒▒▒] 40%", env.TELEGRAM_BOT_TOKEN);

		const fileBuffer = await downloadTelegramFile(fileInfo.result.file_path, env.TELEGRAM_BOT_TOKEN);
		await editMessage(chatId, statusMsg.result.message_id, "☁️ <b>Storing in R2...</b>\n[████████▒▒] 80%", env.TELEGRAM_BOT_TOKEN);

		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const r2Key = `${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`;
		
		await env.MY_BUCKET.put(r2Key, fileBuffer, {
			httpMeta: { contentType: fileObj.mime_type || "application/octet-stream" }
		});

		const finalMsg = `✨ <b>Upload Complete!</b>\n\n📄 <b>Name:</b> ${fileName}\n🔑 <b>Key:</b> <code>${r2Key}</code>`;
		await editMessage(chatId, statusMsg.result.message_id, finalMsg, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		await sendMessage(chatId, `❌ Error: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Animation & Utility Helpers ---
async function sendChatAction(chatId, action, botToken) {
	await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, action: action })
	});
}

async function editMessage(chatId, messageId, text, botToken) {
	return await (await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text, parse_mode: "HTML" })
	})).json();
}

async function deleteMessage(chatId, messageId, botToken) {
	await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, message_id: messageId })
	});
}

async function sendMessage(chatId, text, botToken) {
	return await (await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML" })
	})).json();
}

async function getTelegramFileInfo(fileId, botToken) {
	return await (await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)).json();
}

async function downloadTelegramFile(filePath, botToken) {
	const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
	return await res.arrayBuffer();
}
