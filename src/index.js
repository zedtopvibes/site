export default {
	async fetch(request, env, ctx) {
		if (request.method === "POST") {
			try {
				const update = await request.json();
				// Ensure the worker handles both messages and button clicks
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
	// 1. Handle Button Clicks (Callback Queries for Download)
	if (update.callback_query) {
		const chatId = update.callback_query.message.chat.id;
		const data = update.callback_query.data; 
		
		if (data.startsWith("dl:")) {
			const key = data.replace("dl:", "");
			// Show a quick "toast" notification on the user's screen
			await answerCallback(update.callback_query.id, "🚀 Preparing your file...", env.TELEGRAM_BOT_TOKEN);
			await sendFileFromR2(chatId, key, env);
		}
		return;
	}

	if (!update.message) return;
	const message = update.message;
	const chatId = message.chat.id;
	const text = message.text;

	// 2. Handle Commands (/start, /list, /search)
	if (text) {
		if (text.startsWith("/start") || text.startsWith("/help")) {
			await sendMessage(chatId, 
				"👋 <b>Aitestzm Storage</b>\n\n" +
				"• <b>Upload:</b> Just send me any file!\n" +
				"• <b>List:</b> Use /list to see recent files\n" +
				"• <b>Search:</b> Use /search &lt;name&gt;", 
				env.TELEGRAM_BOT_TOKEN
			);
			return;
		}

		if (text.startsWith("/list")) {
			await handleListCommand(chatId, env);
			await deleteMessage(chatId, message.message_id, env.TELEGRAM_BOT_TOKEN); // Clean user command
			return;
		}

		if (text.startsWith("/search")) {
			const query = text.replace("/search", "").trim();
			if (!query) return sendMessage(chatId, "Format: /search song", env.TELEGRAM_BOT_TOKEN);
			await handleSearchCommand(chatId, query, env);
			await deleteMessage(chatId, message.message_id, env.TELEGRAM_BOT_TOKEN); // Clean user command
			return;
		}
	}

	// 3. Handle File Uploads (Restored & Enhanced)
	const fileObj = message.document || 
					message.video || 
					message.audio || 
					(message.photo ? message.photo[message.photo.length - 1] : null);

	if (fileObj) {
		await handleFileUpload(chatId, fileObj, env);
		// Clean up the user's original file message to keep chat history tidy (Optional)
		// await deleteMessage(chatId, message.message_id, env.TELEGRAM_BOT_TOKEN); 
	}
}

// --- Feature: Upload with Animation ---
async function handleFileUpload(chatId, fileObj, env) {
	// Send initial status message
	const status = await sendMessage(chatId, "📡 <b>Connecting...</b>\n[▒▒▒▒▒▒▒▒▒▒] 0%", env.TELEGRAM_BOT_TOKEN);
	
	try {
		// Update 1: Fetching from Telegram
		await editMessage(chatId, status.result.message_id, "📥 <b>Downloading from Telegram...</b>\n[████▒▒▒▒▒▒] 40%", env.TELEGRAM_BOT_TOKEN);
		
		const fileInfo = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileObj.file_id}`)).json();
		const fileBuffer = await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`)).arrayBuffer();

		// Update 2: Pushing to R2
		await editMessage(chatId, status.result.message_id, "☁️ <b>Saving to Cloud Storage...</b>\n[████████▒▒] 80%", env.TELEGRAM_BOT_TOKEN);
		
		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const r2Key = `${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`;
		
		await env.MY_BUCKET.put(r2Key, fileBuffer, {
			httpMeta: { contentType: fileObj.mime_type || "application/octet-stream" }
		});

		// Final Success State
		await editMessage(chatId, status.result.message_id, `✨ <b>Upload Complete!</b>\n📄 <code>${fileName}</code>\n🔑 Key: <code>${r2Key}</code>`, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		await editMessage(chatId, status.result.message_id, "❌ <b>Upload Failed.</b>", env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: Send File (Self-Cleaning) ---
async function sendFileFromR2(chatId, key, env) {
	const prog = await sendMessage(chatId, "⏳ <i>Retrieving file...</i>", env.TELEGRAM_BOT_TOKEN);
	try {
		await sendChatAction(chatId, "upload_document", env.TELEGRAM_BOT_TOKEN);
		const object = await env.MY_BUCKET.get(key);
		const fileBuffer = await object.arrayBuffer();
		const fileName = key.split('_').slice(2).join('_') || key;

		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append("document", new Blob([fileBuffer]), fileName);
		formData.append("caption", `✅ <b>File:</b> ${fileName}`);
		formData.append("parse_mode", "HTML");

		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: formData });
		
		// Remove the "Retrieving" message once the file is actually sent
		await deleteMessage(chatId, prog.result.message_id, env.TELEGRAM_BOT_TOKEN);
	} catch (e) {
		await editMessage(chatId, prog.result.message_id, "⚠️ Error sending file.", env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: List/Search with Inline Buttons ---
async function handleListCommand(chatId, env) {
	const listed = await env.MY_BUCKET.list({ limit: 10 });
	if (listed.objects.length === 0) return sendMessage(chatId, "📂 Storage is empty.", env.TELEGRAM_BOT_TOKEN);

	const buttons = listed.objects.map(obj => ([{
		text: `📄 ${obj.key.split('_').slice(2).join('_') || obj.key}`,
		callback_data: `dl:${obj.key}`
	}]));

	await sendMessage(chatId, "📂 <b>Recent Files:</b>\nTap to download:", env.TELEGRAM_BOT_TOKEN, { inline_keyboard: buttons });
}

async function handleSearchCommand(chatId, query, env) {
	const status = await sendMessage(chatId, `🔍 Searching for "${query}"...`, env.TELEGRAM_BOT_TOKEN);
	const listed = await env.MY_BUCKET.list({ limit: 50 });
	const matches = listed.objects.filter(obj => obj.key.toLowerCase().includes(query.toLowerCase()));

	if (matches.length === 0) {
		await editMessage(chatId, status.result.message_id, `❌ No matches for "${query}".`, env.TELEGRAM_BOT_TOKEN);
		return;
	}

	const buttons = matches.slice(0, 10).map(obj => ([{
		text: `⬇️ ${obj.key.split('_').slice(2).join('_')}`,
		callback_data: `dl:${obj.key}`
	}]));

	await editMessage(chatId, status.result.message_id, `✅ Matches for "${query}":`, env.TELEGRAM_BOT_TOKEN, { inline_keyboard: buttons });
}

// --- Standard Helpers ---
async function sendMessage(chatId, text, token, replyMarkup = null) {
	const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", reply_markup: replyMarkup })
	});
	return await res.json();
}

async function editMessage(chatId, msgId, text, token, replyMarkup = null) {
	return await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, message_id: msgId, text: text, parse_mode: "HTML", reply_markup: replyMarkup })
	});
}

async function deleteMessage(chatId, msgId, token) {
	await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, message_id: msgId })
	});
}

async function answerCallback(callbackId, text, token) {
	await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ callback_query_id: callbackId, text: text })
	});
}

async function sendChatAction(chatId, action, token) {
	await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, action: action })
	});
}
