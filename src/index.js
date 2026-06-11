require('dotenv').config();
const cron = require('node-cron');
const { Markup, Telegraf } = require('telegraf');

const {
	sendReport,
	sendPlayerWinrate,
	sendPlayersWinrate,
	sendLastMatchStats,
	sendLastMatchesList,
	sendMatchDetails,
	sendLastPlayTime,
	sendHeroesStats,
	sendStreaks,
	sendPartyStats,
	generateChallenge,
	handleAsk,
	deleteMessage,
	deleteAction,
} = require('./commands');
const { refreshPlayers } = require('./requests');
const { storage } = require('./storage');
const { TELEGRAM_BOT_TOKEN, CHAT_ID } = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

function createTelegramSender(telegram, chatId) {
	return {
		replyWithHTML: (msg) => telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }),
		replyWithPhoto: (url) => telegram.sendPhoto(chatId, url),
	};
}

function safeCommand(handler) {
	return async (ctx) => {
		await deleteMessage(ctx);
		try {
			await handler(ctx);
		} catch (err) {
			console.error('Command error:', err.message);
			try { await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`); } catch (_) {}
		}
	};
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
	const { TELEGRAM_USERNAMES } = require('./constants');
	await ctx.reply(TELEGRAM_USERNAMES.join(' '));
}));

bot.command('ask', safeCommand((ctx) => handleAsk(ctx)));

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

bot.telegram.setMyCommands([
	{ command: 'report', description: 'Отчёт по матчам (/report или /report week)' },
	{ command: 'winrate', description: 'Винрейт в турбо' },
	{ command: 'last', description: 'Последний матч' },
	{ command: 'heroes', description: 'Топ-3 героев' },
	{ command: 'streak', description: 'Серии побед/поражений' },
	{ command: 'party', description: 'Совместные игры' },
	{ command: 'week', description: 'Недельный отчёт' },
	{ command: 'time', description: 'Время без Dota 2' },
	{ command: 'challenge', description: 'Рандомный челлендж' },
	{ command: 'ask', description: 'Задать вопрос ИИ (/ask вопрос)' },
	{ command: 'call', description: 'Позвать всех' },
]);

if (CHAT_ID) {
	cron.schedule('0 8 * * *', () => {
		const sender = createTelegramSender(bot.telegram, CHAT_ID);
		sendReport(sender, 'yesterday');
	}, {
		scheduled: true,
		timezone: 'Europe/Vilnius'
	});
}

bot.catch(async (err, ctx) => {
	console.error(`Error for ${ctx.updateType}:`, err.message);
	try {
		await ctx.replyWithHTML(`<blockquote>Ошибка: ${err.message}</blockquote>`);
	} catch (_) {}
});

refreshPlayers().catch(err => console.error('Player refresh failed:', err.message));

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
