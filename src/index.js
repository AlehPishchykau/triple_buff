require('dotenv').config();
const cron = require('node-cron');
const { Markup, Telegraf } = require('telegraf');

const { 
	sendReport,
	sendPlayerWinrate,
	sendPlayersWinrate,
	sendLastMatchStats,
	deleteMessage,
	deleteAction,
	sendLastPlayTime
} = require('./commands');
const { storage } = require('./storage');
const { TELEGRAM_BOT_TOKEN } = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
let cronTask = null;

bot.command('start', async (ctx) => {
	await deleteMessage(ctx);
	cronTask?.stop?.();
	
	cronTask = cron.schedule('0 8 * * *', () => {
		sendReport(ctx);
	}, {
		scheduled: true,
		timezone: "Europe/Vilnius"
	});
});

bot.command('stop', async (ctx) => {
	await deleteMessage(ctx);
	cronTask?.stop?.();
	cronTask = null;
});

bot.command('cron', async (ctx) => {
	await deleteMessage(ctx);
	ctx.sendMessage(cronTask ? 'Cron is working' : 'Cron is stopped');
});

bot.command('winrate', async (ctx) => {
	await deleteMessage(ctx);

	const playersData = await storage.getPlayers();
	const buttons = Object.entries(playersData).map(([id, data]) => {
		return Markup.button.callback(data.name, `winrate:${id}`);
	});

	return ctx.reply(
		'All time winrate',
		Markup.inlineKeyboard(buttons, { columns: 1 })
	);
});

bot.command('winrate30', async (ctx) => {
	await deleteMessage(ctx);

	const playersData = await storage.getPlayers();
	const buttons = Object.entries(playersData).map(([id, data]) => {
		return Markup.button.callback(data.name, `winrate30:${id}`);
	});

	return ctx.reply(
		'Last month winrate',
		Markup.inlineKeyboard(buttons, { columns: 1 })
	);
});

bot.command('winrate_all', async (ctx) => {
	await deleteMessage(ctx);
	await sendPlayersWinrate(ctx);
});

bot.command('winrate30_all', async (ctx) => {
	await deleteMessage(ctx);
	await sendPlayersWinrate(ctx, 'oneMonth');
});

bot.command('last', async (ctx) => {
	await deleteMessage(ctx);

	const playersData = await storage.getPlayers();
	const buttons = Object.entries(playersData).map(([id, data]) => {
		return Markup.button.callback(data.name, `last:${id}`);
	});

	return ctx.reply(
		'Last turbo match stats',
		Markup.inlineKeyboard(buttons, { columns: 1 })
	);
});

bot.command('time', async (ctx) => {
	await deleteMessage(ctx);

	sendLastPlayTime(ctx);
});

bot.command('adios', async (ctx) => {
	await deleteMessage(ctx);
	ctx.replyWithVoice('BQACAgIAAxkBAAIBLWWpm5CuDGxJZe5dkFhVLCK-0k8KAAKyPgACgwVJSVAsluDHpCQlNAQ');
});

bot.action(/winrate:.+/, async (ctx) => {
	await deleteAction(ctx);

	const command = ctx.match[0];
	const playerId = command.split(':')[1];

	sendPlayerWinrate(ctx, playerId);
});

bot.action(/winrate30:.+/, async (ctx) => {
	await deleteAction(ctx);

	const command = ctx.match[0];
	const playerId = command.split(':')[1];

	sendPlayerWinrate(ctx, playerId, 'oneMonth');
});

bot.action(/last:.+/, async (ctx) => {
	await deleteAction(ctx);

	const command = ctx.match[0];
	const playerId = command.split(':')[1];

	sendLastMatchStats(ctx, playerId);
});

bot.telegram.setMyCommands([
	{
		command: 'last',
		description: 'Last turbo match stats',
	},
	{
		command: 'time',
		description: 'Time without Dota 2',
	},
	{
		command: 'winrate',
		description: 'All time winrate in turbo',
	},
	{
		command: 'winrate30',
		description: 'Last month winrate in turbo',
	},
	{
		command: 'winrate_all',
		description: 'All time winrate in turbo for all men',
	},
	{
		command: 'winrate30_all',
		description: 'Last month winrate in turbo for all men',
	}
]);

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
