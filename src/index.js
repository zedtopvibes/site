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
	if (!update.message && !update.callback_query) return;

	// Handle callback queries from inline keyboards
	if (update.callback_query) {
		await handleCallbackQuery(update.callback_query, env);
		return;
	}

	const message = update.message;
	const chatId = message.chat.id;
	const userId = message.from?.id;
	const text = message.text;

	// Rate limiting using R2 (create a rate-limit file)
	if (!await checkRateLimit(userId, env)) {
		await sendMessage(chatId, "⏰ Please wait a few seconds before making more requests.", env.TELEGRAM_BOT_TOKEN);
		return;
	}

	if (text) {
		if (text.startsWith("/start")) {
			await sendWelcomeMessage(chatId, env);
			return;
		}
		if (text.startsWith("/search")) {
			const query = text.replace("/search", "").trim();
			if (!query) return sendMessage(chatId, "📝 Usage: /search <keyword>\nExample: /search photo", env.TELEGRAM_BOT_TOKEN);
			await handleSearchCommand(chatId, query, env);
			return;
		}
		if (text.startsWith("/list")) {
			await handleListCommand(chatId, env, 1);
			return;
		}
		if (text.startsWith("/delete")) {
			const key = text.replace("/delete", "").trim();
			if (!key) return sendMessage(chatId, "📝 Usage: /delete <file_key>\nFind keys using /list", env.TELEGRAM_BOT_TOKEN);
			await handleDeleteCommand(chatId, key, env);
			return;
		}
		if (text.startsWith("/stats")) {
			await handleStatsCommand(chatId, env);
			return;
		}
		if (text.startsWith("/help")) {
			await sendHelpMessage(chatId, env);
			return;
		}
		if (text.startsWith("/admin")) {
			// Check if user is admin
			if (userId.toString() !== env.ADMIN_ID) {
				await sendMessage(chatId, "⛔ Admin only command!", env.TELEGRAM_BOT_TOKEN);
				return;
			}
			await handleAdminCommand(chatId, text, env);
			return;
		}
	}

	const fileObj = message.document || message.video || message.audio || message.voice || (message.photo ? message.photo[message.photo.length - 1] : null);
	if (fileObj) await handleFileUpload(chatId, fileObj, message, env);
}

// --- Rate Limiting using R2 ---
async function checkRateLimit(userId, env) {
	if (!userId) return true;
	
	const now = Date.now();
	const rateLimitKey = `ratelimit_${userId}.json`;
	const limit = 10; // 10 requests
	const window = 10000; // per 10 seconds
	
	try {
		const object = await env.MY_BUCKET.get(rateLimitKey);
		let data = { count: 0, firstRequest: now };
		
		if (object) {
			const text = await object.text();
			data = JSON.parse(text);
		}
		
		if (now - data.firstRequest > window) {
			// Reset window
			data = { count: 1, firstRequest: now };
			await env.MY_BUCKET.put(rateLimitKey, JSON.stringify(data), {
				httpMeta: { contentType: "application/json" }
			});
			return true;
		}
		
		if (data.count >= limit) {
			return false;
		}
		
		data.count++;
		await env.MY_BUCKET.put(rateLimitKey, JSON.stringify(data), {
			httpMeta: { contentType: "application/json" }
		});
		return true;
		
	} catch (error) {
		// If error, allow the request
		return true;
	}
}

// --- Welcome Message with Inline Keyboard ---
async function sendWelcomeMessage(chatId, env) {
	const keyboard = {
		inline_keyboard: [
			[
				{ text: "📁 List Files", callback_data: "list_files" },
				{ text: "📊 Stats", callback_data: "show_stats" }
			],
			[
				{ text: "❓ Help", callback_data: "show_help" }
			]
		]
	};
	
	await sendMessage(chatId, 
		"🎉 <b>Welcome to AITestZMBot!</b>\n\n" +
		"📤 <b>Features:</b>\n" +
		"• Send any file to store in cloud storage\n" +
		"• Search files using /search <keyword>\n" +
		"• List all files with /list\n" +
		"• Delete files with /delete <key>\n" +
		"• View storage stats with /stats\n\n" +
		"💡 <b>Tip:</b> Files are organized by type automatically!",
		env.TELEGRAM_BOT_TOKEN,
		keyboard
	);
}

// --- Help Message ---
async function sendHelpMessage(chatId, env) {
	const helpText = `
📚 <b>Available Commands:</b>

🎯 <b>Basic Commands:</b>
/start - Start the bot
/help - Show this help message

🔍 <b>File Management:</b>
/search &lt;keyword&gt; - Search files by name
/list - List all your files
/delete &lt;file_key&gt; - Delete a specific file
/stats - View storage statistics

📤 <b>Upload:</b>
Simply send any file (document, photo, video, audio)

⚡ <b>Tips:</b>
• Files are automatically organized by type
• Maximum file size: 50MB (Telegram limit)
• Use inline buttons for quick actions

<b>Example:</b>
/search vacation
/delete document/123456_abc_file.pdf
	`;
	
	const keyboard = {
		inline_keyboard: [
			[{ text: "📁 List My Files", callback_data: "list_files" }],
			[{ text: "📊 View Stats", callback_data: "show_stats" }]
		]
	};
	
	await sendMessage(chatId, helpText, env.TELEGRAM_BOT_TOKEN, keyboard);
}

// --- List Command with Pagination ---
async function handleListCommand(chatId, env, page = 1) {
	try {
		await sendChatAction(chatId, "typing", env.TELEGRAM_BOT_TOKEN);
		
		// List all objects (R2 doesn't support native pagination well, so we do it manually)
		const listed = await env.MY_BUCKET.list({ limit: 200 });
		
		// Filter out rate limit files and metadata files
		const files = listed.objects.filter(obj => 
			!obj.key.startsWith('ratelimit_') && 
			!obj.key.startsWith('userfiles_') &&
			!obj.key.endsWith('.json')
		);
		
		const itemsPerPage = 10;
		const totalPages = Math.ceil(files.length / itemsPerPage);
		
		if (files.length === 0) {
			await sendMessage(chatId, "📭 No files found. Send me a file to get started!", env.TELEGRAM_BOT_TOKEN);
			return;
		}
		
		const start = (page - 1) * itemsPerPage;
		const end = start + itemsPerPage;
		const pageItems = files.slice(start, end);
		
		let message = `📁 <b>Your Files</b> (Page ${page}/${totalPages})\n\n`;
		for (let idx = 0; idx < pageItems.length; idx++) {
			const obj = pageItems[idx];
			const fileName = extractFileName(obj.key);
			const size = formatFileSize(obj.size);
			message += `${start + idx + 1}. <code>${fileName.substring(0, 40)}</code>\n   📦 ${size} | 🔑 <code>${obj.key.substring(0, 40)}...</code>\n\n`;
		}
		
		// Add navigation keyboard
		const keyboard = { inline_keyboard: [] };
		
		const navButtons = [];
		if (page > 1) {
			navButtons.push({ text: "◀️ Previous", callback_data: `list_page_${page - 1}` });
		}
		if (page < totalPages) {
			navButtons.push({ text: "Next ▶️", callback_data: `list_page_${page + 1}` });
		}
		if (navButtons.length > 0) {
			keyboard.inline_keyboard.push(navButtons);
		}
		
		keyboard.inline_keyboard.push([{ text: "🗑️ Delete File", callback_data: "delete_file_menu" }]);
		
		await sendMessage(chatId, message, env.TELEGRAM_BOT_TOKEN, keyboard);
		
	} catch (error) {
		await sendMessage(chatId, `❌ Error listing files: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Search Command ---
async function handleSearchCommand(chatId, query, env) {
	try {
		await sendChatAction(chatId, "typing", env.TELEGRAM_BOT_TOKEN);
		const statusMsg = await sendMessage(chatId, `🔍 Searching for <b>"${query}"</b>...`, env.TELEGRAM_BOT_TOKEN);
		
		const listed = await env.MY_BUCKET.list({ limit: 500 });
		
		// Filter files and search
		const matches = listed.objects.filter(obj => {
			if (obj.key.startsWith('ratelimit_') || obj.key.endsWith('.json')) return false;
			const fileName = extractFileName(obj.key);
			return fileName.toLowerCase().includes(query.toLowerCase()) || 
			       obj.key.toLowerCase().includes(query.toLowerCase());
		});
		
		if (matches.length === 0) {
			await editMessage(chatId, statusMsg.result.message_id, `❌ No files found for "${query}".`, env.TELEGRAM_BOT_TOKEN);
			return;
		}
		
		// Limit to 20 files per search
		const filesToSend = matches.slice(0, 20);
		
		await editMessage(chatId, statusMsg.result.message_id, 
			`✅ Found ${matches.length} file(s). Sending ${filesToSend.length} files...\n⏱️ Please wait.`,
			env.TELEGRAM_BOT_TOKEN
		);
		
		let sent = 0;
		for (const obj of filesToSend) {
			await sendFileFromR2(chatId, obj.key, env);
			sent++;
			
			if (sent % 5 === 0 && sent < filesToSend.length) {
				await editMessage(chatId, statusMsg.result.message_id, 
					`📤 Progress: ${sent}/${filesToSend.length} files sent...`,
					env.TELEGRAM_BOT_TOKEN
				);
			}
		}
		
		await deleteMessage(chatId, statusMsg.result.message_id, env.TELEGRAM_BOT_TOKEN);
		
		if (matches.length > 20) {
			await sendMessage(chatId, 
				`⚠️ Showing first 20 of ${matches.length} matches.\nUse more specific keywords for better results.`,
				env.TELEGRAM_BOT_TOKEN
			);
		}
		
	} catch (error) {
		await sendMessage(chatId, `❌ Search Error: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- File Upload Handler ---
async function handleFileUpload(chatId, fileObj, message, env) {
	let statusMsg;
	try {
		// Check file size
		if (fileObj.file_size > 50 * 1024 * 1024) {
			await sendMessage(chatId, "❌ File too large! Maximum size is 50MB.", env.TELEGRAM_BOT_TOKEN);
			return;
		}
		
		statusMsg = await sendMessage(chatId, "📥 <b>Starting Upload...</b>\n[▒▒▒▒▒▒▒▒▒▒] 0%", env.TELEGRAM_BOT_TOKEN);
		
		await editMessage(chatId, statusMsg.result.message_id, "📡 <b>Downloading from Telegram...</b>\n[████▒▒▒▒▒▒] 40%", env.TELEGRAM_BOT_TOKEN);
		
		const fileInfo = await getTelegramFileInfo(fileObj.file_id, env.TELEGRAM_BOT_TOKEN);
		const fileBuffer = await downloadTelegramFile(fileInfo.result.file_path, env.TELEGRAM_BOT_TOKEN);
		
		await editMessage(chatId, statusMsg.result.message_id, "☁️ <b>Storing in R2...</b>\n[████████▒▒] 80%", env.TELEGRAM_BOT_TOKEN);
		
		// Create organized R2 key
		const fileName = fileObj.file_name || `file_${Date.now()}`;
		const fileType = fileObj.mime_type?.split('/')[0] || 'file';
		const timestamp = Date.now();
		const randomId = Math.random().toString(36).substring(7);
		const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
		const r2Key = `${fileType}/${timestamp}_${randomId}_${safeFileName}`;
		
		// Store file with metadata
		await env.MY_BUCKET.put(r2Key, fileBuffer, {
			httpMeta: { 
				contentType: fileObj.mime_type || "application/octet-stream",
				cacheControl: "public, max-age=31536000"
			},
			customMetadata: {
				originalName: fileName,
				uploadedBy: chatId.toString(),
				uploadedAt: new Date().toISOString(),
				fileSize: fileObj.file_size.toString(),
				fileId: fileObj.file_id
			}
		});
		
		// Store user file index (for faster user-specific queries)
		await updateUserFileIndex(chatId, r2Key, env);
		
		const size = formatFileSize(fileBuffer.byteLength);
		const finalMsg = `✅ <b>Upload Complete!</b>\n\n` +
			`📄 <b>Name:</b> ${fileName}\n` +
			`📦 <b>Size:</b> ${size}\n` +
			`🏷️ <b>Type:</b> ${fileObj.mime_type || 'Unknown'}\n` +
			`🔑 <b>Key:</b> <code>${r2Key}</code>\n\n` +
			`<i>Use /search ${fileName.substring(0, 20)} to find this file</i>`;
		
		await editMessage(chatId, statusMsg.result.message_id, finalMsg, env.TELEGRAM_BOT_TOKEN);
		
	} catch (error) {
		console.error("Upload Error:", error);
		if (statusMsg) {
			await editMessage(chatId, statusMsg.result.message_id, 
				`❌ Upload failed: ${error.message}\nPlease try again.`,
				env.TELEGRAM_BOT_TOKEN
			);
		} else {
			await sendMessage(chatId, `❌ Upload failed: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
		}
	}
}

// --- Update User File Index (using R2) ---
async function updateUserFileIndex(chatId, fileKey, env) {
	try {
		const userIndexKey = `userfiles_${chatId}.json`;
		let userFiles = [];
		
		try {
			const object = await env.MY_BUCKET.get(userIndexKey);
			if (object) {
				const text = await object.text();
				userFiles = JSON.parse(text);
			}
		} catch (e) {
			// Index doesn't exist yet
		}
		
		userFiles.push({
			key: fileKey,
			uploadedAt: Date.now()
		});
		
		// Keep only last 1000 files per user to avoid huge files
		if (userFiles.length > 1000) {
			userFiles = userFiles.slice(-1000);
		}
		
		await env.MY_BUCKET.put(userIndexKey, JSON.stringify(userFiles), {
			httpMeta: { contentType: "application/json" }
		});
		
	} catch (error) {
		console.error("Error updating user index:", error);
	}
}

// --- Delete Command ---
async function handleDeleteCommand(chatId, key, env) {
	try {
		await sendChatAction(chatId, "typing", env.TELEGRAM_BOT_TOKEN);
		
		// Check if file exists
		const object = await env.MY_BUCKET.get(key);
		if (!object) {
			await sendMessage(chatId, `❌ File not found with key: ${key}`, env.TELEGRAM_BOT_TOKEN);
			return;
		}
		
		// Confirm deletion with inline keyboard
		const keyboard = {
			inline_keyboard: [
				[
					{ text: "✅ Yes, Delete", callback_data: `confirm_delete_${key}` },
					{ text: "❌ Cancel", callback_data: "cancel_delete" }
				]
			]
		};
		
		const fileName = extractFileName(key);
		await sendMessage(chatId, 
			`⚠️ <b>Confirm Deletion</b>\n\nAre you sure you want to delete:\n<code>${fileName}</code>\n\nThis action cannot be undone!`,
			env.TELEGRAM_BOT_TOKEN,
			keyboard
		);
		
	} catch (error) {
		await sendMessage(chatId, `❌ Error: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Stats Command ---
async function handleStatsCommand(chatId, env) {
	try {
		await sendChatAction(chatId, "typing", env.TELEGRAM_BOT_TOKEN);
		
		const listed = await env.MY_BUCKET.list({ limit: 1000 });
		
		// Filter out metadata files
		const files = listed.objects.filter(obj => 
			!obj.key.startsWith('ratelimit_') && 
			!obj.key.startsWith('userfiles_') &&
			!obj.key.endsWith('.json')
		);
		
		const totalFiles = files.length;
		let totalSize = 0;
		const typeStats = {};
		
		for (const obj of files) {
			totalSize += obj.size;
			const type = obj.key.split('/')[0];
			typeStats[type] = (typeStats[type] || 0) + 1;
		}
		
		const typeBreakdown = Object.entries(typeStats)
			.map(([type, count]) => `• ${type}: ${count} files`)
			.join('\n');
		
		const statsMsg = `📊 <b>Storage Statistics</b>\n\n` +
			`📁 <b>Total Files:</b> ${totalFiles}\n` +
			`💾 <b>Total Size:</b> ${formatFileSize(totalSize)}\n` +
			`📈 <b>Average Size:</b> ${formatFileSize(totalSize / (totalFiles || 1))}\n\n` +
			`<b>File Type Breakdown:</b>\n${typeBreakdown || 'No files yet'}`;
		
		await sendMessage(chatId, statsMsg, env.TELEGRAM_BOT_TOKEN);
		
	} catch (error) {
		await sendMessage(chatId, `❌ Error getting stats: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
	}
}

// --- Admin Command ---
async function handleAdminCommand(chatId, text, env) {
	const command = text.replace("/admin", "").trim();
	
	if (command === "stats") {
		await handleStatsCommand(chatId, env);
	} else if (command === "cleanup") {
		await sendMessage(chatId, "🧹 Cleaning up temporary files...", env.TELEGRAM_BOT_TOKEN);
		// Add cleanup logic here if needed
	} else {
		await sendMessage(chatId, 
			"🔧 <b>Admin Commands:</b>\n\n" +
			"/admin stats - View full storage stats\n" +
			"/admin cleanup - Clean up temporary files",
			env.TELEGRAM_BOT_TOKEN
		);
	}
}

// --- Send File from R2 with Retry ---
async function sendFileFromR2(chatId, key, env, retryCount = 0) {
	let progressMsg;
	try {
		progressMsg = await sendMessage(chatId, `🚀 <b>Retrieving:</b> <code>${key.substring(0, 50)}</code>\n[▒▒▒▒▒▒▒▒▒▒] 0%`, env.TELEGRAM_BOT_TOKEN);
		
		const object = await env.MY_BUCKET.get(key);
		if (!object) throw new Error("File not found in storage.");
		
		await editMessage(chatId, progressMsg.result.message_id, `📤 <b>Streaming to Telegram...</b>\n[██████▒▒▒▒] 60%`, env.TELEGRAM_BOT_TOKEN);
		await sendChatAction(chatId, "upload_document", env.TELEGRAM_BOT_TOKEN);
		
		const fileBuffer = await object.arrayBuffer();
		const fileName = object.customMetadata?.originalName || extractFileName(key);
		
		const formData = new FormData();
		formData.append("chat_id", chatId);
		formData.append("document", new Blob([fileBuffer]), fileName);
		formData.append("caption", `✅ <b>File Delivered</b>\n📄 <code>${fileName}</code>\n📦 Size: ${formatFileSize(fileBuffer.byteLength)}`);
		formData.append("parse_mode", "HTML");
		
		const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
			method: "POST",
			body: formData
		});
		
		if (!response.ok && retryCount < 3) {
			throw new Error(`Telegram API error: ${response.status}`);
		}
		
		await deleteMessage(chatId, progressMsg.result.message_id, env.TELEGRAM_BOT_TOKEN);
		
	} catch (error) {
		console.error("Send error:", error);
		if (progressMsg) {
			await editMessage(chatId, progressMsg.result.message_id, 
				`⚠️ Failed to send: ${error.message}\n${retryCount < 3 ? 'Retrying...' : ''}`,
				env.TELEGRAM_BOT_TOKEN
			);
		}
		
		if (retryCount < 3) {
			await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
			await sendFileFromR2(chatId, key, env, retryCount + 1);
		}
	}
}

// --- Handle Callback Queries ---
async function handleCallbackQuery(callbackQuery, env) {
	const chatId = callbackQuery.message.chat.id;
	const messageId = callbackQuery.message.message_id;
	const data = callbackQuery.data;
	
	// Answer callback to remove loading state
	await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ callback_query_id: callbackQuery.id })
	});
	
	if (data === "list_files") {
		await handleListCommand(chatId, env, 1);
	} else if (data === "show_stats") {
		await handleStatsCommand(chatId, env);
	} else if (data === "show_help") {
		await sendHelpMessage(chatId, env);
	} else if (data === "delete_file_menu") {
		await sendMessage(chatId, "Please use /delete <file_key> to delete a file.\n\nFind the file key using /list", env.TELEGRAM_BOT_TOKEN);
	} else if (data === "cancel_delete") {
		await deleteMessage(chatId, messageId, env.TELEGRAM_BOT_TOKEN);
		await sendMessage(chatId, "✅ Deletion cancelled.", env.TELEGRAM_BOT_TOKEN);
	} else if (data.startsWith("confirm_delete_")) {
		const key = data.replace("confirm_delete_", "");
		await deleteMessage(chatId, messageId, env.TELEGRAM_BOT_TOKEN);
		
		try {
			await env.MY_BUCKET.delete(key);
			
			// Remove from user index
			const userIndexKey = `userfiles_${chatId}.json`;
			try {
				const object = await env.MY_BUCKET.get(userIndexKey);
				if (object) {
					const text = await object.text();
					let userFiles = JSON.parse(text);
					userFiles = userFiles.filter(f => f.key !== key);
					await env.MY_BUCKET.put(userIndexKey, JSON.stringify(userFiles), {
						httpMeta: { contentType: "application/json" }
					});
				}
			} catch (e) {
				// Ignore index errors
			}
			
			await sendMessage(chatId, `✅ File deleted successfully!\n🔑 ${key}`, env.TELEGRAM_BOT_TOKEN);
		} catch (error) {
			await sendMessage(chatId, `❌ Failed to delete: ${error.message}`, env.TELEGRAM_BOT_TOKEN);
		}
	} else if (data.startsWith("list_page_")) {
		const page = parseInt(data.replace("list_page_", ""));
		await handleListCommand(chatId, env, page);
	}
}

// --- Utility Functions ---
function extractFileName(key) {
	// Extract original filename from R2 key (format: type/timestamp_randomid_filename)
	const parts = key.split('_');
	if (parts.length >= 3) {
		return parts.slice(2).join('_');
	}
	return key;
}

function formatFileSize(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function sendMessage(chatId, text, botToken, replyMarkup = null) {
	const payload = {
		chat_id: chatId,
		text: text,
		parse_mode: "HTML"
	};
	
	if (replyMarkup) {
		payload.reply_markup = replyMarkup;
	}
	
	return await (await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	})).json();
}

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

async function getTelegramFileInfo(fileId, botToken) {
	return await (await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`)).json();
}

async function downloadTelegramFile(filePath, botToken) {
	const res = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
	return await res.arrayBuffer();
}