require('dotenv').config();
const cron = require('node-cron');
const { Markup, Telegraf } = require('telegraf');

const { sendReport, sendPlayerWinrate, sendLastMatchStats } = require('./commands');
const { storage } = require('./storage');
const { SERVER_URL, TELEGRAM_BOT_TOKEN } = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
let cronTask = null;

bot.command('start', (ctx) => {
	cronTask?.stop?.();
	
	cronTask = cron.schedule('0 8 * * *', () => {
		sendReport(ctx);
	}, {
		scheduled: true,
		timezone: "Europe/Vilnius"
	});
});

bot.command('stop', (ctx) => {
	cronTask?.stop?.();
	cronTask = null;
});

bot.command('cron', (ctx) => {
	ctx.sendMessage(cronTask ? 'Cron is working' : 'Cron is stopped');
});

bot.command('winrate', async (ctx) => {
	const playersData = await storage.getPlayers();
	const buttons = Object.entries(playersData).map(([id, data]) => {
		return Markup.button.callback(data.name, `winrate:${id}`);
	});

	return ctx.reply(
		'Выбери мужика:',
		Markup.inlineKeyboard(buttons, { columns: 1 })
	);
});

bot.command('winrate30', async (ctx) => {
	const playersData = await storage.getPlayers();
	const buttons = Object.entries(playersData).map(([id, data]) => {
		return Markup.button.callback(data.name, `winrate30:${id}`);
	});

	return ctx.reply(
		'Выбери мужика:',
		Markup.inlineKeyboard(buttons, { columns: 1 })
	);
});

bot.command('last', async (ctx) => {
	const playersData = await storage.getPlayers();
	const buttons = Object.entries(playersData).map(([id, data]) => {
		return Markup.button.callback(data.name, `last:${id}`);
	});

	return ctx.reply(
		'Выбери мужика:',
		Markup.inlineKeyboard(buttons, { columns: 1 })
	);
});

bot.command('adios', async (ctx) => {
	ctx.replyWithVoice('BQACAgIAAxkBAAIBLWWpm5CuDGxJZe5dkFhVLCK-0k8KAAKyPgACgwVJSVAsluDHpCQlNAQ');
});

bot.action(/winrate:.+/, (ctx) => {
	const command = ctx.match[0];
	const playerId = command.split(':')[1];

	sendPlayerWinrate(ctx, playerId);
});

bot.action(/winrate30:.+/, (ctx) => {
	const command = ctx.match[0];
	const playerId = command.split(':')[1];

	sendPlayerWinrate(ctx, playerId, 'oneMonth');
});

bot.action(/last:.+/, (ctx) => {
	const command = ctx.match[0];
	const playerId = command.split(':')[1];

	sendLastMatchStats(ctx, playerId);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
