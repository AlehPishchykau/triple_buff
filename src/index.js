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
	deleteMessage,
	deleteAction,
} = require('./commands');
const { storage } = require('./storage');
const { TELEGRAM_BOT_TOKEN, CHAT_ID } = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

function createTelegramSender(telegram, chatId) {
	return {
		replyWithHTML: (msg) => telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }),
		replyWithPhoto: (url) => telegram.sendPhoto(chatId, url),
	};
}

bot.command('report', async (ctx) => {
	await deleteMessage(ctx);
	const arg = ctx.message.text.split(' ')[1];
	const period = arg === 'week' ? 'week' : 'today';
	sendReport(ctx, period);
});

bot.command('winrate', async (ctx) => {
	await deleteMessage(ctx);
	return ctx.reply(
		'Выбери период:',
		Markup.inlineKeyboard([
			[Markup.button.callback('За все время', 'wr_period:allTime'),
			 Markup.button.callback('За месяц', 'wr_period:oneMonth')]
		])
	);
});

bot.command('last', async (ctx) => {
	await deleteMessage(ctx);
	const result = await sendLastMatchesList(ctx);
	if (!result) return;

	const { convertMiliseconds } = require('./utils');
	const buttons = result.matches.map(m => {
		const ago = convertMiliseconds(Date.now() - m.startDateTime * 1000);
		const emoji = m.isVictory ? '✅' : '❌';
		const label = `${emoji} ${m.playerName} — ${m.heroName} (${m.kills}/${m.deaths}/${m.assists}) ${ago}`;
		return [Markup.button.callback(label, `match:${m.matchId}:${m.playerId}`)];
	});

	return ctx.reply(
		'Последние матчи:',
		Markup.inlineKeyboard(buttons)
	);
});

bot.command('time', async (ctx) => {
	await deleteMessage(ctx);

	sendLastPlayTime(ctx);
});

bot.command('heroes', async (ctx) => {
	await deleteMessage(ctx);
	sendHeroesStats(ctx);
});

bot.command('streak', async (ctx) => {
	await deleteMessage(ctx);
	sendStreaks(ctx);
});

bot.command('party', async (ctx) => {
	await deleteMessage(ctx);
	sendPartyStats(ctx);
});

bot.command('week', async (ctx) => {
	await deleteMessage(ctx);
	sendReport(ctx, 'week');
});

bot.command('adios', async (ctx) => {
	await deleteMessage(ctx);
	ctx.replyWithVoice('BQACAgIAAxkBAAIBLWWpm5CuDGxJZe5dkFhVLCK-0k8KAAKyPgACgwVJSVAsluDHpCQlNAQ');
});

bot.action(/wr_period:(.+)/, async (ctx) => {
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
});

bot.action(/wr_player:(.+):(.+)/, async (ctx) => {
	await deleteAction(ctx);
	const period = ctx.match[1];
	const playerId = ctx.match[2];
	if (playerId === 'all') {
		await sendPlayersWinrate(ctx, period);
	} else {
		await sendPlayerWinrate(ctx, playerId, period);
	}
});

bot.action(/match:(\d+):(\d+)/, async (ctx) => {
	await deleteAction(ctx);
	const matchId = ctx.match[1];
	const playerId = ctx.match[2];
	sendMatchDetails(ctx, matchId, playerId);
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

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
