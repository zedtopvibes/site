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
			await showTyping(chatId, env.TELEGRAM_BOT_TOKEN);
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
			await showTyping(chatId, env.TELEGRAM_BOT_TOKEN);
			await sendMessage(chatId, 
				"📚 <b>Help</b>\n" +
				"• <b>Upload:</b> Send any file (Doc, Photo, Video).\n" +
				"• <b>Search:</b> /search song → Get results instantly.\n" +
				"• <b>Delete:</b> Admins only: /delete <key>", 
				env.TELEGRAM_BOT_TOKEN
			);
			return;		}

		if (text.startsWith("/search")) {
			const query = text.replace("/search", "").trim();
			if (!query) {
				await sendMessage(chatId, "❌ Usage: /search <keyword>", env.TELEGRAM_BOT_TOKEN);
				return;
			}
			await handleSearchCommand(chatId, query, env);
			return;
		}

		if (text.startsWith("/list")) {
			await showTyping(chatId, env.TELEGRAM_BOT_TOKEN);
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
				await sendMessage(chatId, "❌ Usage: /delete <file_key>", env.TELEGRAM_BOT_TOKEN);
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

// --- Helper: Show "Typing" Animation ---
async function showTyping(chatId, botToken) {
	try {
		const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
		await fetch(url, {
			method: "POST",			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				action: "typing"
			})
		});
	} catch (e) {
		// Ignore errors for typing animation - it's cosmetic
	}
}

// --- Helper: Show "Upload Document" Animation ---
async function showUploading(chatId, botToken) {
	try {
		const url = `https://api.telegram.org/bot${botToken}/sendChatAction`;
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				action: "upload_document"
			})
		});
	} catch (e) {
		// Ignore errors
	}
}

// --- Feature: Smart Search ---
async function handleSearchCommand(chatId, query, env) {
	try {
		await showTyping(chatId, env.TELEGRAM_BOT_TOKEN);
		const loadingMsg = await sendMessage(chatId, `🔍 <i>Searching for "${query}"...</i>`, env.TELEGRAM_BOT_TOKEN);

		// List objects (Limit 50 for search results)
		const listed = await env.MY_BUCKET.list({ limit: 50 });
		
		const lowerQuery = query.toLowerCase();
		const matches = listed.objects.filter(obj => 
			obj.key.toLowerCase().includes(lowerQuery)
		);

		if (matches.length === 0) {
			await editMessage(chatId, loadingMsg?.message_id, `❌ No files found for "${query}".`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		if (matches.length > 3) {
			// Too many files, list them instead
			let text = `🔍 Found ${matches.length} files. Please be more specific.\n\nTop 5:\n`;			matches.slice(0, 5).forEach(obj => {
				text += `• <code>${obj.key}</code>\n`;
			});
			text += `\n<i>Try searching with a more unique name.</i>`;
			await editMessage(chatId, loadingMsg?.message_id, text, env.TELEGRAM_BOT_TOKEN);
		} else {
			// Few files, send them directly
			await editMessage(chatId, loadingMsg?.message_id, `✅ Sending ${matches.length} file(s)...`, env.TELEGRAM_BOT_TOKEN);
			
			await showUploading(chatId, env.TELEGRAM_BOT_TOKEN);
			for (const obj of matches) {
				await sendFileFromR2(chatId, obj.key, env);
			}
		}

	} catch (error) {
		console.error("Search Error:", error);
		await sendMessage(chatId, `❌ Search failed: ${error.message || "Unknown error"}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: Send Actual File from R2 ---
async function sendFileFromR2(chatId, key, env) {
	try {
		await showUploading(chatId, env.TELEGRAM_BOT_TOKEN);
		
		const object = await env.MY_BUCKET.get(key);

		if (object === null) {
			await sendMessage(chatId, `❌ File not found in storage: ${key}`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		// Check size (Limit to 50MB to prevent Worker crash/timeout)
		const MAX_SIZE = 50 * 1024 * 1024; // 50MB
		if (object.size && object.size > MAX_SIZE) {
			await sendMessage(chatId, `⚠️ File too large to send directly (${formatBytes(object.size)}). Max: ${formatBytes(MAX_SIZE)}.`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		const fileBuffer = await object.arrayBuffer();
		const contentType = object.httpMetadata?.contentType || "application/octet-stream";
		
		// Extract filename from key (format: timestamp_random_filename)
		const parts = key.split('_');
		const fileName = parts.slice(2).join('_') || key;

		const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
		
		const formData = new FormData();		formData.append("chat_id", chatId);
		formData.append("document", new Blob([fileBuffer], { type: contentType }), fileName);
		formData.append("caption", `📄 <b>${fileName}</b>\n📦 ${formatBytes(fileBuffer.byteLength)}`);
		formData.append("parse_mode", "HTML");

		// Add timeout to fetch
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

		const res = await fetch(url, {
			method: "POST",
			body: formData,
			signal: controller.signal
		});
		
		clearTimeout(timeout);

		if (!res.ok) {
			const errText = await res.text().catch(() => "Unknown error");
			throw new Error(`Telegram API Error ${res.status}: ${errText}`);
		}

	} catch (error) {
		if (error.name === "AbortError") {
			await sendMessage(chatId, `⏱️ Timeout sending ${key}. File may be too large or connection slow.`, env.TELEGRAM_BOT_TOKEN);
		} else {
			console.error(`Error sending ${key}:`, error);
			await sendMessage(chatId, `⚠️ Failed to send ${key}: ${error.message || "Unknown error"}`, env.TELEGRAM_BOT_TOKEN);
		}
	}
}

// --- Feature: File Upload ---
async function handleFileUpload(chatId, fileObj, env) {
	try {
		await showUploading(chatId, env.TELEGRAM_BOT_TOKEN);
		const loadingMsg = await sendMessage(chatId, "📤 <i>Uploading to cloud...</i>", env.TELEGRAM_BOT_TOKEN);

		// Validate file size (Telegram limit is 20MB for bots, 50MB for premium)
		const MAX_TELEGRAM_SIZE = 20 * 1024 * 1024; // 20MB standard bot limit
		if (fileObj.file_size && fileObj.file_size > MAX_TELEGRAM_SIZE) {
			await editMessage(chatId, loadingMsg?.message_id, `❌ File too large (${formatBytes(fileObj.file_size)}). Max: ${formatBytes(MAX_TELEGRAM_SIZE)}.`, env.TELEGRAM_BOT_TOKEN);
			return;
		}

		const fileInfo = await getTelegramFileInfo(fileObj.file_id, env.TELEGRAM_BOT_TOKEN);
		if (!fileInfo.ok) throw new Error(`Telegram API: ${fileInfo.description || "Unknown error"}`);

		const filePath = fileInfo.result.file_path;
		const fileName = fileObj.file_name || `file_${Date.now()}`;		const mimeType = fileObj.mime_type || "application/octet-stream";

		// Download with timeout
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 60000); // 60 second timeout for download

		let fileBuffer;
		try {
			fileBuffer = await downloadTelegramFile(filePath, env.TELEGRAM_BOT_TOKEN, controller.signal);
		} finally {
			clearTimeout(timeout);
		}

		const timestamp = Date.now();
		const randomStr = Math.random().toString(36).substring(7);
		const r2Key = `${timestamp}_${randomStr}_${fileName}`;

		// Upload to R2
		await env.MY_BUCKET.put(r2Key, fileBuffer, {
			httpMeta: {
				contentType: mimeType,
			},
		});

		const msg = `✅ <b>Upload Successful!</b>\n\n` +
					`📄 <b>Name:</b> ${fileName}\n` +
					`📦 <b>Size:</b> ${formatBytes(fileObj.file_size)}\n` +
					`🔑 <b>Key:</b> \`${r2Key}\``;

		await editMessage(chatId, loadingMsg?.message_id, msg, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		console.error("Upload Error:", error);
		let errorMsg = "❌ Upload failed";
		
		if (error.name === "AbortError") {
			errorMsg = "⏱️ Upload timed out. File may be too large or connection slow.";
		} else if (error.message?.includes("403")) {
			errorMsg = "🚫 Permission denied. Check your R2 bucket settings.";
		} else if (error.message?.includes("404")) {
			errorMsg = "🔍 File not found on Telegram servers. Try again.";
		} else if (error.message) {
			errorMsg = `❌ ${error.message}`;
		}
		
		await sendMessage(chatId, errorMsg, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: List Files ---async function handleListCommand(chatId, env) {
	try {
		const listed = await env.MY_BUCKET.list({ limit: 10 });
		
		if (listed.objects.length === 0) {
			await sendMessage(chatId, "📂 Bucket is empty.", env.TELEGRAM_BOT_TOKEN);
			return;
		}

		let text = "📂 <b>Recent Files:</b>\n\n";
		listed.objects.forEach((obj, index) => {
			text += `${index + 1}. <code>${obj.key}</code> (${formatBytes(obj.size)})\n`;
		});
		text += `\n<i>Use /search <name> to download.</i>`;

		await sendMessage(chatId, text, env.TELEGRAM_BOT_TOKEN);

	} catch (error) {
		console.error("List Error:", error);
		await sendMessage(chatId, `❌ Error listing files: ${error.message || "Unknown error"}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Feature: Delete File ---
async function handleDeleteCommand(chatId, key, env) {
	try {
		await showTyping(chatId, env.TELEGRAM_BOT_TOKEN);
		
		// Check if file exists first
		const object = await env.MY_BUCKET.get(key);
		if (object === null) {
			await sendMessage(chatId, `❌ File not found: ${key}`, env.TELEGRAM_BOT_TOKEN);
			return;
		}
		
		await env.MY_BUCKET.delete(key);
		await sendMessage(chatId, `🗑️ Deleted: <code>${key}</code>`, env.TELEGRAM_BOT_TOKEN);
		
	} catch (error) {
		console.error("Delete Error:", error);
		await sendMessage(chatId, `❌ Delete failed: ${error.message || "Unknown error"}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Helpers ---

async function getTelegramFileInfo(fileId, botToken) {
	const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
	const res = await fetch(url);
	return await res.json();}

async function downloadTelegramFile(filePath, botToken, signal) {
	const url = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
	return await res.arrayBuffer();
}

async function sendMessage(chatId, text, botToken) {
	try {
		const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text: text,
				parse_mode: "HTML"
			})
		});
		
		if (!res.ok) {
			console.error(`sendMessage failed: ${res.status}`);
			return null;
		}
		
		const data = await res.json();
		return data.result; // Return message object for editing
	} catch (error) {
		console.error("sendMessage error:", error);
		return null;
	}
}

async function editMessage(chatId, messageId, text, botToken) {
	if (!messageId) {
		// Fallback to new message if we don't have a message ID to edit
		await sendMessage(chatId, text, botToken);
		return;
	}
	
	try {
		const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				message_id: messageId,				text: text,
				parse_mode: "HTML"
			})
		});
		
		if (!res.ok) {
			// If edit fails (e.g., message too old), send new message
			await sendMessage(chatId, text, botToken);
		}
	} catch (error) {
		// Fallback to new message on error
		await sendMessage(chatId, text, botToken);
	}
}

function formatBytes(bytes, decimals = 2) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}