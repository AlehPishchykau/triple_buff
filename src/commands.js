const { TURBO_ID } = require('./constants');
const {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerMatchesStats,
	fetchLastMatchData,
	fetchPlayerHeroesStats,
	fetchGameModes
} = require('./requests');
const { storage } = require('./storage');
const { secondsToTime } = require('./utils');

async function sendReport(ctx) {
	const matchesData = await fetchMatchesData();
	const playersData = await fetchPlayersData();

	const parsedMatchesData = parseMatchesData(matchesData);

	const summary = getSummary(parsedMatchesData, playersData);
	const mvp = getMVP(parsedMatchesData, playersData);

	await sendMatchesSummary(ctx, summary);
	await sendMVP(ctx, mvp);
}

async function sendMatchesSummary(ctx, message) {
	await ctx.replyWithHTML(message);
}

async function sendMVP(ctx, mvp) {
	if (mvp.avatar) {
		await ctx.replyWithPhoto(
			mvp.avatar,
			{ caption: 'MVP', has_spoiler: true }
		);
	}
}

async function sendPlayerWinrate(ctx, playerId, period = 'allTime') {
	const players = await storage.getPlayers();
	const matches = await fetchPlayerMatchesStats(playerId);
	const turboMatchesStats = matches[period].gameModeMatches.find((matchesByGameMode) => matchesByGameMode.id === TURBO_ID);

	if (!players[playerId]) {
		return;
	}

	const periodString = period === 'allTime' ? 'за всё время' : 'за последний месяц';

	const message = `
		<blockquote>
		<u><b>${players[playerId].name}</b></u>

		Всего турбированных игр ${periodString}: ${turboMatchesStats.matchCount}.
		Винрейт: ${(turboMatchesStats.win / turboMatchesStats.matchCount * 100).toFixed(1)}%.
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchStats(ctx, playerId) {
	const players = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const lastMatchData = await fetchLastMatchData(playerId);

	if (!lastMatchData || !players[playerId]) {
		return;
	}

	const lastMatchPlayerData = lastMatchData.players[0];
	const hero = heroes[lastMatchPlayerData.heroId];

	const message = `
		<blockquote>
		<u><b>${players[playerId].name}</b></u>
		${(new Date(lastMatchData.startDateTime * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		В ластецкой катке был ${lastMatchPlayerData.isVictory ? 'разъёб' : 'посос'} на ${hero.displayName}.
		Длительность: ${secondsToTime(lastMatchData.durationSeconds)}

		KDA: ${lastMatchPlayerData.numKills} - ${lastMatchPlayerData.numDeaths} - ${lastMatchPlayerData.numAssists}
		Networth: ${lastMatchPlayerData.networth}
		Level: ${lastMatchPlayerData.level}

		Hero DMG: ${lastMatchPlayerData.heroDamage}
		Tower DMG: ${lastMatchPlayerData.towerDamage}

		https://www.dotabuff.com/matches/${lastMatchData.id}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function deleteMessage(ctx) {
	try {
		await ctx.deleteMessage(ctx.update.message.messageId);
	} catch(error) {
		console.log(error);
	}
}

////// PARSER //////
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

	let message = '<blockquote>Статистика вчерашних каток:\n\n';

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
	message += '</blockquote>';

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

module.exports = {
	sendReport,
	sendMatchesSummary,
	sendMVP,
	sendPlayerWinrate,
	sendLastMatchStats,
	deleteMessage
};
