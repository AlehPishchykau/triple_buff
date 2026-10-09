require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const cron = require('node-cron');
const { Markup, Telegraf } = require('telegraf');
const { saveChatMessage, getChatMessages, getVoiceTranscribe, setVoiceTranscribe } = require('./memory');
const persona = require('./persona');
const chatScope = require('./chatScope');
const crossBot = require('./crossBot');
const { startDecayTimer } = require('./mood');

const {
	sendReport,
	sendPlayerWinrate,
	sendPlayersWinrate,
	sendLastMatchesList,
	sendMatchDetails,
	sendLastPlayTime,
	sendHeroesStats,
	sendStreaks,
	sendPartyStats,
	generateChallenge,
	handleAsk,
	handleAskReply,
	rememberReplyChain,
	getDebugInfo,
	deleteMessage,
	deleteAction,
} = require('./commands');
const { refreshPlayers, fetchPlayerData } = require('./requests');
const { storage } = require('./storage');
const players = require('./players');
const TELEGRAM_BOT_TOKEN = process.env[`TELEGRAM_BOT_TOKEN_${persona.command.toUpperCase()}`] || process.env.TELEGRAM_BOT_TOKEN;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

function createTelegramSender(telegram, chatId) {
	return {
		replyWithHTML: (msg) => telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }),
		replyWithPhoto: (url) => telegram.sendPhoto(chatId, url),
	};
}

async function transcribeAudio(telegram, fileId, ext = 'ogg') {
	const fileLink = await telegram.getFileLink(fileId);
	const res = await fetch(fileLink.href);
	const buffer = Buffer.from(await res.arrayBuffer());
	const tmpPath = path.join(os.tmpdir(), `audio_${Date.now()}.${ext}`);
	fs.writeFileSync(tmpPath, buffer);
	try {
		const OpenAI = require('openai');
		const client = new OpenAI();
		const result = await client.audio.transcriptions.create({
			file: fs.createReadStream(tmpPath),
			model: 'whisper-1',
			language: 'ru',
		});
		return result.text;
	} finally {
		try { fs.unlinkSync(tmpPath); } catch (_) {}
	}
}

function saveBotReply(text) {
	const ts = Math.floor(Date.now() / 1000);
	saveChatMessage({ from: persona.command, name: persona.name, text, ts, type: 'bot' });
}

bot.use((ctx, next) => {
	const chatId = ctx.chat?.id;
	if (chatId) return chatScope.run(chatId, next);
	return next();
});

bot.use(async (ctx, next) => {
	if (!ctx.message) return next();
	try {
		const from = ctx.message.from;
		const tag = from.username ? `@${from.username}` : from.first_name;
		const name = from.first_name || from.username || '???';
		const ts = ctx.message.date;
		const text = ctx.message.text || ctx.message.caption;

		const msgId = ctx.message.message_id;

		if (from?.is_bot) {
			if (text) saveChatMessage({ from: tag, name, text, ts, type: 'bot', msgId });
			return next();
		}

		const chatId = ctx.chat?.id;
		if (chatId) crossBot.resetChain(chatId);

		if (text) {
			saveChatMessage({ from: tag, name, text, ts, type: 'text', msgId });
		}
	} catch (err) {
		console.error('Chat log error:', err.message);
	}
	return next();
});

function safeCommand(handler) {
	return async (ctx) => {
		try { await deleteMessage(ctx); } catch (_) {}
		try {
			await handler(ctx);
		} catch (err) {
			console.error('Command error:', err.message);
			try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
		}
	};
}

if (persona.commands) {
	const allowedCommands = new Set([...persona.commands, 'ask', persona.command, 'debug', 'register', 'unregister']);
	bot.use((ctx, next) => {
		if (ctx.message?.text?.startsWith('/')) {
			const cmd = ctx.message.text.split(/[\s@]/)[0].slice(1);
			if (!allowedCommands.has(cmd)) return;
		}
		return next();
	});
}

bot.command('report', safeCommand(async (ctx) => {
	const arg = ctx.message.text.split(' ')[1];
	const period = arg === 'week' ? 'week' : 'today';
	await sendReport(ctx, period);
}));

bot.command('winrate', safeCommand(async (ctx) => {
	await ctx.reply(
		'Выбери период:',
		Markup.inlineKeyboard([
			[Markup.button.callback('За все время', 'wr_period:allTime'),
			 Markup.button.callback('За месяц', 'wr_period:oneMonth')]
		])
	);
}));

bot.command('last', safeCommand(async (ctx) => {
	const result = await sendLastMatchesList(ctx);
	if (!result) return;

	const { convertMiliseconds } = require('./utils');
	const buttons = result.matches.map(m => {
		const ago = convertMiliseconds(Date.now() - m.startDateTime * 1000);
		const emoji = m.isVictory ? '✅' : '❌';
		const label = `${emoji} ${m.playerName} — ${m.heroName} (${m.kills}/${m.deaths}/${m.assists}) ${ago}`;
		return [Markup.button.callback(label, `match:${m.matchId}:${m.playerId}`)];
	});

	await ctx.reply(
		'Последние матчи:',
		Markup.inlineKeyboard(buttons)
	);
}));

bot.command('time', safeCommand((ctx) => sendLastPlayTime(ctx)));
bot.command('heroes', safeCommand((ctx) => sendHeroesStats(ctx)));
bot.command('streak', safeCommand((ctx) => sendStreaks(ctx)));
bot.command('party', safeCommand((ctx) => sendPartyStats(ctx)));
bot.command('week', safeCommand((ctx) => sendReport(ctx, 'week')));

bot.command('transcribe', safeCommand(async (ctx) => {
	const current = getVoiceTranscribe();
	setVoiceTranscribe(!current);
	await ctx.replyWithHTML(`<blockquote>Транскрипция голосовых: <b>${!current ? 'включена' : 'выключена'}</b></blockquote>`);
}));

bot.command('challenge', safeCommand(async (ctx) => {
	const playersData = await storage.getPlayers();
	const playerButtons = Object.entries(playersData).map(([id, data]) =>
		[Markup.button.callback(data.name, `ch:${id}`)]
	);
	await ctx.reply(
		'Кому челлендж?',
		Markup.inlineKeyboard([
			[Markup.button.callback('🎲 Рандом', 'ch:random')],
			...playerButtons
		])
	);
}));

bot.command('call', safeCommand(async (ctx) => {
	const from = ctx.message.from;
	const name = from.username ? `@${from.username}` : from.first_name;
	const usernames = players.getTelegramUsernames();
	const others = usernames.filter(u => u !== `@${from.username}`);
	if (!others.length) {
		await ctx.replyWithHTML('<blockquote>Нет зарегистрированных игроков</blockquote>');
		return;
	}
	await ctx.reply(`Официальный колл от ${name}.\nВ хуй попердеть никто не желает?\n\n${others.join(' ')}`);
}));

bot.command('register', safeCommand(async (ctx) => {
	const args = ctx.message.text.split(/\s+/).slice(1);
	const dotaId = args.pop();
	const name = args.join(' ');
	if (!dotaId || !/^\d+$/.test(dotaId) || !name) {
		await ctx.replyWithHTML('<blockquote>Формат: /register &lt;имя&gt; &lt;dota_id&gt;\nПример: /register Олег 123456789</blockquote>');
		return;
	}
	const from = ctx.message.from;
	const telegram = from.username ? `@${from.username}` : null;
	try {
		await fetchPlayerData(dotaId);
		players.register(dotaId, from.id, telegram, name);
		storage.invalidatePlayers();
		await ctx.replyWithHTML(`<blockquote>${name} (${dotaId}) зарегистрирован${telegram ? ' как ' + telegram : ''}</blockquote>`);
	} catch {
		await ctx.replyWithHTML(`<blockquote>Не удалось найти игрока ${dotaId} на OpenDota</blockquote>`);
	}
}));

bot.command('unregister', safeCommand(async (ctx) => {
	const dotaId = players.unregister(ctx.message.from.id);
	if (dotaId) {
		storage.invalidatePlayers();
		await ctx.replyWithHTML(`<blockquote>Игрок ${dotaId} удалён</blockquote>`);
	} else {
		await ctx.replyWithHTML('<blockquote>Ты не зарегистрирован</blockquote>');
	}
}));

const askHandler = async (ctx) => {
	try {
		await handleAsk(ctx);
	} catch (err) {
		console.error('Ask error:', err.message);
		try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
	}
};
bot.command('ask', askHandler);
bot.command(persona.command, askHandler);
bot.command('debug', safeCommand(async (ctx) => {
	await ctx.replyWithHTML(getDebugInfo());
}));

bot.on('photo', async (ctx, next) => {
	const caption = ctx.message.caption || '';
	if (caption.match(new RegExp('^/(ask|' + persona.command + ')\\b'))) {
		return askHandler(ctx);
	}
	if (ctx.message.reply_to_message) {
		try {
			const handled = await handleAskReply(ctx);
			if (handled) return;
		} catch (err) {
			console.error('Ask reply photo error:', err.message);
			try { await ctx.reply(`Ошибка: ${err.message}`, { reply_parameters: { message_id: ctx.message.message_id } }); } catch (_) {}
		}
	}
	return next();
});

bot.on('text', async (ctx, next) => {
	if (ctx.message.text?.startsWith('/')) return next();

	if (ctx.message.from?.is_bot) {
		const chatId = ctx.chat.id;
		crossBot.trackBotMessage(chatId);

		if (crossBot.canReplyToBot(chatId)) {
			try {
				const botName = ctx.message.from.first_name || ctx.message.from.username;
				const result = await crossBot.handleCrossBotReply(ctx.message.text, botName);
				if (result) {
					crossBot.markBotReply(chatId);
					saveBotReply(result.answer);
					const sent = await ctx.reply(result.answer, { reply_parameters: { message_id: ctx.message.message_id } });
					rememberReplyChain(sent.message_id, result.messages);
				}
			} catch (err) {
				console.error('Cross-bot reply error:', err.message);
			}
		}
		return;
	}

	if (ctx.message.reply_to_message) {
		try {
			const handled = await handleAskReply(ctx);
			if (handled) return;
		} catch (err) {
			console.error('Ask reply error:', err.message);
			try { await ctx.reply(`Ошибка: ${err.message}`, { reply_parameters: { message_id: ctx.message.message_id } }); } catch (_) {}
			return;
		}
	}
	if (persona.triggerRegex.test(ctx.message.text)) {
		ctx.message.text = `/${persona.command} ${ctx.message.text}`;
		return askHandler(ctx);
	}

	if (crossBot.canRandomInterject(ctx.chat.id)) {
		try {
			const now = Math.floor(Date.now() / 1000);
			const recent = getChatMessages(now - 3600, now);
			if (recent.length >= 3) {
				const result = await crossBot.handleRandomInterjection(recent.slice(-20));
				if (result) {
					crossBot.markRandomInterjection(ctx.chat.id);
					saveBotReply(result.answer);
					const sent = await ctx.reply(result.answer, { reply_parameters: { message_id: ctx.message.message_id } });
					rememberReplyChain(sent.message_id, result.messages);
				}
			}
		} catch (err) {
			console.error('Random interjection error:', err.message);
		}
	}

	return next();
});

bot.on(['voice', 'video_note'], async (ctx, next) => {
	const file = ctx.message.voice || ctx.message.video_note;
	if (!file) return next();

	try {
		const ext = ctx.message.voice ? 'ogg' : 'mp4';
		const transcript = await transcribeAudio(ctx.telegram, file.file_id, ext);
		if (!transcript) return next();

		const from = ctx.message.from;
		const tag = from.username ? `@${from.username}` : from.first_name;
		const name = from.first_name || from.username || '???';
		saveChatMessage({ from: tag, name, text: transcript, ts: ctx.message.date, type: 'voice' });

		if (ctx.message.reply_to_message) {
			ctx.message.text = transcript;
			const handled = await handleAskReply(ctx);
			if (handled) return;
		}

		if (persona.triggerRegex.test(transcript)) {
			ctx.message.text = `/${persona.command} ${transcript}`;
			ctx.voiceTranscript = transcript;
			return askHandler(ctx);
		}

		if (getVoiceTranscribe()) {
			ctx.reply(`💬 ${name}: «${transcript}»`, {
				reply_parameters: { message_id: ctx.message.message_id },
			}).catch(() => {});
		}
	} catch (err) {
		console.error('Voice handler error:', err.message);
		try { await ctx.reply(`Ошибка: ${err.message}`, { reply_parameters: { message_id: ctx.message.message_id } }); } catch (_) {}
	}
	return next();
});

bot.command('adios', async (ctx) => {
	await deleteMessage(ctx);
	ctx.replyWithVoice('BQACAgIAAxkBAAIBLWWpm5CuDGxJZe5dkFhVLCK-0k8KAAKyPgACgwVJSVAsluDHpCQlNAQ');
});

bot.action(/wr_period:(.+)/, async (ctx) => {
	try {
		await ctx.answerCbQuery();
		const period = ctx.match[1];
		const playersData = await storage.getPlayers();
		const playerButtons = Object.entries(playersData).map(([id, data]) =>
			[Markup.button.callback(data.name, `wr_player:${period}:${id}`)]
		);
		const periodLabel = period === 'allTime' ? 'За все время' : 'За месяц';
		await ctx.editMessageText(
			`${periodLabel} — выбери игрока:`,
			Markup.inlineKeyboard([
				[Markup.button.callback('Все игроки', `wr_player:${period}:all`)],
				...playerButtons
			])
		);
	} catch (err) {
		console.log('wr_period error:', err.message);
		try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
	}
});

bot.action(/wr_player:(.+):(.+)/, async (ctx) => {
	try {
		await ctx.answerCbQuery();
		await deleteAction(ctx);
		const period = ctx.match[1];
		const playerId = ctx.match[2];
		if (playerId === 'all') {
			await sendPlayersWinrate(ctx, period);
		} else {
			await sendPlayerWinrate(ctx, playerId, period);
		}
	} catch (err) {
		console.log('wr_player error:', err.message);
		try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
	}
});

bot.action(/match:(\d+):(\d+)/, async (ctx) => {
	try {
		await ctx.answerCbQuery();
		await deleteAction(ctx);
		const matchId = ctx.match[1];
		const playerId = ctx.match[2];
		await sendMatchDetails(ctx, matchId, playerId);
	} catch (err) {
		console.log('match error:', err.message);
		try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
	}
});

bot.action(/ch:(.+)/, async (ctx) => {
	try {
		await ctx.answerCbQuery();
		await deleteAction(ctx);
		await generateChallenge(ctx, ctx.match[1]);
	} catch (err) {
		console.log('challenge error:', err.message);
		try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
	}
});

const COMMAND_DESCRIPTIONS = {
	report: 'Отчёт по матчам (/report или /report week)',
	winrate: 'Винрейт в турбо',
	last: 'Последний матч',
	heroes: 'Топ-3 героев',
	streak: 'Серии побед/поражений',
	party: 'Совместные игры',
	week: 'Недельный отчёт',
	time: 'Время без Dota 2',
	challenge: 'Рандомный челлендж',
	call: 'Позвать всех',
	transcribe: 'Вкл/выкл транскрипцию голосовых',
};

const botCommands = [
	{ command: 'ask', description: 'Задать вопрос ИИ (/ask вопрос)' },
	{ command: persona.command, description: `Спросить ${persona.name} (/${persona.command} вопрос)` },
	{ command: 'register', description: 'Привязать Dota аккаунт (/register <dota_id>)' },
	{ command: 'unregister', description: 'Отвязать Dota аккаунт' },
];
const enabledCmds = persona.commands || Object.keys(COMMAND_DESCRIPTIONS);
for (const name of enabledCmds) {
	if (COMMAND_DESCRIPTIONS[name]) {
		botCommands.push({ command: name, description: COMMAND_DESCRIPTIONS[name] });
	}
}
bot.telegram.setMyCommands(botCommands);

if (!persona.commands || persona.commands.includes('report')) {
	cron.schedule(persona.cron?.schedule || '0 8 * * *', async () => {
		for (const chatId of chatScope.listChatIds()) {
			try {
				await chatScope.run(chatId, async () => {
					if (players.getIds().length === 0) return;
					const sender = createTelegramSender(bot.telegram, chatId);
					await sendReport(sender, 'yesterday');
				});
			} catch (err) {
				console.error(`Cron report error [${chatId}]:`, err.message);
			}
		}
	}, {
		scheduled: true,
		timezone: persona.cron?.timezone || 'Europe/Vilnius'
	});
}

startDecayTimer();

bot.catch(async (err, ctx) => {
	console.error(`Error for ${ctx.updateType}:`, err.message);
	try {
		await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`);
	} catch (_) {}
});

Promise.all(
	chatScope.listChatIds().map(id =>
		chatScope.run(id, () => refreshPlayers())
	)
).catch(err => console.error('Player refresh failed:', err.message));

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
