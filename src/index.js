const fs = require('node:fs');
const cron = require('node-cron');
const { Telegraf } = require('telegraf');

const BOT_TOKEN = '6560688756:AAGXL6oTwscUXPDQKGywN44-M-h2iZ6eHXw';
const STRATZ_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJTdWJqZWN0IjoiMDg2ODU5OWQtZWYyNS00ODVkLTlkYWYtYTI4N2QwNTQxMzlmIiwiU3RlYW1JZCI6IjE1NzMzOTMyNSIsIm5iZiI6MTcwNTQyMjE2NSwiZXhwIjoxNzM2OTU4MTY1LCJpYXQiOjE3MDU0MjIxNjUsImlzcyI6Imh0dHBzOi8vYXBpLnN0cmF0ei5jb20ifQ.cSl2npOvw_BulbgNoG7TTdkYHuqNDwn2zFVbJkhh0s4';
const STRATZ_API = 'https://api.stratz.com/api/v1/';
const players = [
	157339325, // Tango
	128559468, // Midas
	162211548, // Vodorod
	56193772,  // Mechasm
	128920198, // Desolator
	306666325, // Mango
];

const bot = new Telegraf(BOT_TOKEN);
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
	writeJSONToFile(ctx);
	cronTask?.stop?.();
});

bot.command('report', (ctx) => {
	sendReport(ctx);
});

bot.command('stats', async (ctx) => {
	// const playerId = ctx.payload;
	// const matchesStats = await fetchPlayerMatchesStats(playerId);
	// const heroesStats = await fetchPlayerHeroesStats(playerId);

	// writeJSONToFile(heroesStats);
});

bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

async function sendReport(ctx) {
	const matchesData = await fetchMatchesData();
	const playersData = await fetchPlayersData();
	const playersMap = playersData.reduce((acc, value) => {
		const { id, avatar, name } = value.steamAccount;

		acc[id] = {
			avatar,
			name
		};

		return acc;
	}, {});

	const parsedMatchesData = parseMatchesData(matchesData);

	const summary = getSummary(parsedMatchesData, playersMap);
	const mvp = getMVP(parsedMatchesData, playersMap);

	await sendMatchesSummary(ctx, summary);
	await sendMVP(ctx, mvp);
}

async function sendMatchesSummary(ctx, message) {
	await ctx.telegram.sendMessage(ctx.message.chat.id, message);
}

async function sendMVP(ctx, mvp) {
	if (mvp.avatar) {
		await ctx.replyWithPhoto(
			mvp.avatar,
			{ caption: 'MVP', has_spoiler: true }
		);
	}
}

//////////////////////// REQUESTS ////////////////////////

async function fetchMatchesData() {
	const startDateTime = Math.round(Date.now() / 1000 - 86400);
	const matchesRequests = [];

	players.forEach((playerId) => {
		const matchesRequest = request(`Player/${playerId}/matches`, {
			startDateTime
		});

		matchesRequests.push(matchesRequest);
	})

	const responses = await Promise.all(matchesRequests);
	const result = await Promise.all(responses.map(response => response.json()));

	return result;
}

async function fetchPlayersData() {
	const playersRequests = [];

	players.forEach((playerId) => {
		const playerRequest = request(`Player/${playerId}`);

		playersRequests.push(playerRequest);
	})

	const responses = await Promise.all(playersRequests);
	const result = await Promise.all(responses.map(response => response.json()));

	return result;
}

async function fetchPlayerMatchesStats(playerId) {
	const response = await request(`Player/${playerId}/summary`);

	return await response.json();
}

async function fetchPlayerHeroesStats(playerId) {
	const response = await request(`Player/${playerId}/heroPerformance`);

	return await response.json();
}

async function fetchGameModes() {
	const response = await request(`GameMode`);

	return await response.json();
}

//////////////////////// PARSER ////////////////////////

function parseMatchesData(matchesByPlayer) {
	const result = {
		players: {},
		summary: {
			longestMatchDuration: null,
			shortestMatchDuration: Infinity, 
			wins: {},
			loses: {},
		}
	};

	matchesByPlayer.forEach((playerMatches) => {
		playerMatches.forEach((match) => {
			const player = match.players[0];
			const {
				steamAccountId,
				numKills,
				numDeaths,
				numAssists,
				goldPerMinute,
          		experiencePerMinute,
				networth,
				isVictory,
			} = player;

			if (!result.players[steamAccountId]) {
				result.players[steamAccountId] = {
					wins: 0,
					loses: 0,
					kdas: [],
					gpms: [],
					xpms: [],
					nws: []
				};
			}

			if (isVictory) {
				result.players[steamAccountId].wins++;
				result.summary.wins[match.id] = true;
			} else {
				result.players[steamAccountId].loses++;
				result.summary.loses[match.id] = true;
			}

			result.players[steamAccountId].kdas.push((numKills + numAssists) / (numDeaths || 1));
			result.players[steamAccountId].gpms.push(goldPerMinute);
			result.players[steamAccountId].xpms.push(experiencePerMinute);
			result.players[steamAccountId].nws.push(networth);

			if (match.durationSeconds > result.summary.longestMatchDuration) {
				result.summary.longestMatchDuration = match.durationSeconds;
			}

			if (match.durationSeconds < result.summary.shortestMatchDuration) {
				result.summary.shortestMatchDuration = match.durationSeconds;
			}
		});
	});

	return result;
}

function getSummary(data, playersMap) {
	const wins = Object.keys(data.summary.wins).length;
	const loses = Object.keys(data.summary.loses).length;
	const players = Object.keys(data.players).map((playerId) => playersMap[playerId].name).sort();
	const stats = {};

	if (!players.length) {
		return 'Всем похуй на игру...';
	}

	Object.entries(data.players).forEach(([key, value]) => {
		const maxKDA = Math.max(...value.kdas);
		const maxNW = Math.max(...value.nws);
		const maxGPM = Math.max(...value.gpms);

		if (maxKDA > (stats.topKDA?.value || 0)) {
			stats.topKDA = {
				name: playersMap[key].name,
				value: maxKDA
			}
		}

		if (maxNW > (stats.topNW?.value || 0)) {
			stats.topNW = {
				name: playersMap[key].name,
				value: maxNW
			}
		}

		if (maxGPM > (stats.topGPM?.value || 0)) {
			stats.topGPM = {
				name: playersMap[key].name,
				value: maxGPM
			}
		}
	});

	let message = 'Статистика вчерашних каток:\n\n';

	if (players.length === 1) {
		message += `Единственный крепкий мужчина - ${players[0]}.`;
	} else {
		message += `Крепкие мужчины слева направо - ${players.join(', ')}.`;
	}

	message += `\nПобед - ${wins}. Поражений - ${loses}`;
	message += `\nСамая долгая катка длилась ${secondsToTime(data.summary.longestMatchDuration)}. Самая короткая - ${secondsToTime(data.summary.shortestMatchDuration)}.`;
	message += '\n';
	message += `\nЛучший KDA - ${stats.topKDA.value.toFixed(2)} (${stats.topKDA.name})`;
	message += `\nЛучший нетворс - ${stats.topNW.value} (${stats.topNW.name})`;

	return message;
}

function getMVP(data, playersMap) {
	let mvp = {};

	Object.entries(data.players).forEach(([key, value]) => {
		const kdaAvg = value.kdas.reduce((a, b) => a + b, 0) / value.kdas.length;
		const nwAvg = value.nws.reduce((a, b) => a + b, 0) / value.nws.length;
		const score = kdaAvg * 100 + nwAvg;

		if (score > (mvp.score || 0)) {
			const { avatar, name} = playersMap[key];

			mvp = {
				avatar,
				name,
				score,
			}
		}
	});

	return mvp;
}

//////////////////////// UTILS ////////////////////////

async function request(path, params) {
	return await fetch(STRATZ_API + path + getParamsString(params), {
		headers: { Authorization: `Bearer ${STRATZ_TOKEN}` }
	})
}

function getParamsString(params = {}) {
	const paramsArray = [];

	Object.entries(params).forEach(([key, value]) => {
		paramsArray.push(`${key}=${value}`);
	});

	const paramsString = paramsArray.join('&');

	return paramsString ? `?${paramsString}` : '';
}

function secondsToTime(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	function padTo2Digits(num) {
		return num.toString().padStart(2, '0');
	}

	return `${padTo2Digits(minutes)}:${padTo2Digits(seconds)}`;
}

function writeJSONToFile(data) {
	fs.writeFile('./output.json', JSON.stringify(data), err => {
		if (err) {
		console.error(err);
		}
	})
}

