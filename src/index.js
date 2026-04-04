export default {
	async fetch(request, env, ctx) {
		if (request.method === "POST") {
			try {
				const update = await request.json();
				// Handle both messages and button clicks (callback_query)
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
	// 1. Handle Button Clicks (Callback Queries)
	if (update.callback_query) {
		const chatId = update.callback_query.message.chat.id;
		const data = update.callback_query.data; // This is the R2 Key
		const messageId = update.callback_query.message.message_id;

		if (data.startsWith("dl:")) {
			const key = data.replace("dl:", "");
			await answerCallback(update.callback_query.id, "🚀 Fetching file...", env.TELEGRAM_BOT_TOKEN);
			await sendFileFromR2(chatId, key, env);
		}
		return;
	}

	if (!update.message) return;
	const message = update.message;
	const chatId = message.chat.id;
	const text = message.text;

	// 2. Handle Commands
	if (text) {
		if (text.startsWith("/start") || text.startsWith("/help")) {
			const welcome = "👋 <b>Aitestzm Storage</b>\n\n" +
						  "• Send any file to upload\n" +
						  "• Use /list to see files\n" +
						  "• Use /search &lt;name&gt; to find files";
			await sendMessage(chatId, welcome, env.TELEGRAM_BOT_TOKEN);
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

	// 3. Handle File Uploads
	const fileObj = message.document || message.video || message.audio || (message.photo ? message.photo[message.photo.length - 1] : null);
	if (fileObj) {
		await handleFileUpload(chatId, fileObj, env);
	}
}

// --- List Files with Buttons ---
async function handleListCommand(chatId, env) {
	const listed = await env.MY_BUCKET.list({ limit: 10 });
	if (listed.objects.length === 0) return sendMessage(chatId, "📂 Bucket is empty.", env.TELEGRAM_BOT_TOKEN);

	const buttons = listed.objects.map(obj => ([{
		text: `📄 ${obj.key.split('_').slice(2).join('_') || obj.key}`,
		callback_data: `dl:${obj.key}`
	}]));

	await sendMessage(chatId, "📂 <b>Recent Files:</b>\nClick a file to download.", env.TELEGRAM_BOT_TOKEN, {
		inline_keyboard: buttons
	});
}

// --- Search with Buttons ---
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

	await editMessage(chatId, status.result.message_id, `✅ Found ${matches.length} matches:`, env.TELEGRAM_BOT_TOKEN, {
		inline_keyboard: buttons
	});
}

// --- Sending File (Self-Cleaning) ---
async function sendFileFromR2(chatId, key, env) {
	const prog = await sendMessage(chatId, "⏳ <i>Preparing file...</i>", env.TELEGRAM_BOT_TOKEN);
	try {
		await sendChatAction(chatId, "upload_document", env.TELEGRAM_BOT_TOKEN);
		const object = await env.MY_BUCKET.get(key);
		const fileBuffer = await object.arrayBuffer();
		const fileName = key.split('_').slice(2).join('_') || key;

		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append("document", new Blob([fileBuffer]), fileName);
		formData.append("caption", `✅ <b>Sent:</b> <code>${fileName}</code>`);
		formData.append("parse_mode", "HTML");

		await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, { method: "POST", body: formData });
		await deleteMessage(chatId, prog.result.message_id, env.TELEGRAM_BOT_TOKEN); // Remove "Preparing" msg
	} catch (e) {
		await editMessage(chatId, prog.result.message_id, "⚠️ Failed to send file.", env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Upload (Self-Cleaning) ---
async function handleFileUpload(chatId, fileObj, env) {
	const status = await sendMessage(chatId, "📡 <b>Uploading...</b>\n[▒▒▒▒▒▒▒▒▒▒] 0%", env.TELEGRAM_BOT_TOKEN);
	try {
		const fileInfo = await (await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileObj.file_id}`)).json();
		const fileBuffer = await (await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${fileInfo.result.file_path}`)).arrayBuffer();

		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const r2Key = `${Date.now()}_${Math.random().toString(36).substring(7)}_${fileName}`;
		
		await env.MY_BUCKET.put(r2Key, fileBuffer, { httpMeta: { contentType: fileObj.mime_type } });

		await editMessage(chatId, status.result.message_id, `✨ <b>Success!</b>\n📄 <code>${fileName}</code>`, env.TELEGRAM_BOT_TOKEN);
		// Optional: Delete success message after 10 seconds to keep chat pristine
		// setTimeout(() => deleteMessage(chatId, status.result.message_id, env.TELEGRAM_BOT_TOKEN), 10000);
	} catch (e) {
		await editMessage(chatId, status.result.message_id, "❌ Upload Failed.", env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Clean Helpers ---
async function sendMessage(chatId, text, token, replyMarkup = null) {
	return await (await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "HTML", reply_markup: replyMarkup })
	})).json();
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
