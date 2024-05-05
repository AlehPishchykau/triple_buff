const { TURBO_ID } = require('./constants');
const {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerMatchesStats,
	fetchLastMatchData
} = require('./requests');
const { storage } = require('./storage');
const { secondsToTime, convertMiliseconds, writeJSONToFile } = require('./utils');

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
	const message = `
		<blockquote>
		<b>MVP - ${mvp.name}</b>
		WL: ${mvp.wins} - ${mvp.loses} 
		Avg KDA: ${mvp.kdaAvg.toFixed(1)}
		Avg Networth: ${mvp.nwAvg.toFixed(0)}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);

	if (mvp.avatar) {
		await ctx.replyWithPhoto(mvp.avatar);
	}
}

async function sendPlayersWinrate(ctx, period = 'allTime') {
	const playersMap = await storage.getPlayers();
	const requests = Object.keys(playersMap).map((playerId) => {
		return fetchPlayerMatchesStats(playerId);
	});

	const response = await Promise.all(requests);
	const periodString = period === 'allTime' ? 'All time' : 'Last month';
	const players = Object.values(playersMap);

	const playersStats = response.map((matches, index) => {
		const turboMatchesStats = matches[period].gameModeMatches.find((matchesByGameMode) => matchesByGameMode.id === TURBO_ID);

		return `
			<b>${players[index].name}</b>
			Matches: ${turboMatchesStats.matchCount}
			Winrate: ${(turboMatchesStats.win / turboMatchesStats.matchCount * 100).toFixed(1)}%
		`;
	})

	const message = `
		<blockquote>
		<b>${periodString} turbo matches</b>
		${playersStats.join('')}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendPlayerWinrate(ctx, playerId, period = 'allTime') {
	const players = await storage.getPlayers();
	const matches = await fetchPlayerMatchesStats(playerId);
	const turboMatchesStats = matches[period].gameModeMatches.find((matchesByGameMode) => matchesByGameMode.id === TURBO_ID);

	if (!players[playerId]) {
		return;
	}

	const periodString = period === 'allTime' ? 'All time' : 'Last month';

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b>

		${periodString} turbo matches: ${turboMatchesStats.matchCount}
		Winrate: ${(turboMatchesStats.win / turboMatchesStats.matchCount * 100).toFixed(1)}%
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchStats(ctx, playerId) {
	const players = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const lastMatchData = await fetchLastMatchData(playerId, TURBO_ID);

	if (!lastMatchData || !players[playerId]) {
		return;
	}

	const lastMatchPlayerData = lastMatchData.players[0];
	const hero = heroes[lastMatchPlayerData.heroId];

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b> <a href="https://www.dotabuff.com/matches/${lastMatchData.id}">${lastMatchPlayerData.isVictory ? 'won' : 'lost'} last match on ${hero.displayName}</a>
		${(new Date(lastMatchData.startDateTime * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		Duration: ${secondsToTime(lastMatchData.durationSeconds)}
		KDA: ${lastMatchPlayerData.numKills} - ${lastMatchPlayerData.numDeaths} - ${lastMatchPlayerData.numAssists}
		Networth: ${lastMatchPlayerData.networth}
		Level: ${lastMatchPlayerData.level}

		Hero DMG: ${lastMatchPlayerData.heroDamage}
		Tower DMG: ${lastMatchPlayerData.towerDamage}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastPlayTime(ctx) {
	const playersMap = await storage.getPlayers();
	const requests = Object.keys(playersMap).map((playerId) => fetchLastMatchData(playerId));
	const response = await Promise.all(requests);
	const players = Object.values(playersMap);

	const timeStats = response.map((matchData, index) => {
		const time = Date.now() - (matchData.endDateTime * 1000);

		return `${players[index].name}: ${convertMiliseconds(time)}`;
	})

	const message = `
		<blockquote>
		<b>Time without Dota 2</b>
		\n${timeStats.join('\n')}
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

async function deleteAction(ctx) {
	try {
		await ctx.deleteMessage(ctx.update.callback_query.message.messageId);
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
	const players = Object.keys(data.players).map((playerId) => playersMap[playerId].name);
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

	let message = '<blockquote><b>Yesterday matches stats</b>\n\n';

	if (players.length === 1) {
		message += `The only strong man - ${players[0]}. Respect!`;
	} else {
		message += `Strong men - ${players.join(', ')}.`;
	}

	message += `\nWL: ${wins} - ${loses}`;
	message += `\nLongest match - ${secondsToTime(data.summary.longestMatchDuration)}`;
	message += `\nShortest match - ${secondsToTime(data.summary.shortestMatchDuration)}`;
	message += '\n';
	message += `\nBest KDA: ${stats.topKDA.value.toFixed(1)} (${stats.topKDA.name})`;
	message += `\nBest Networth: ${stats.topNW.value} (${stats.topNW.name})`;
	message += '</blockquote>';

	return message;
}

function getMVP(data, playersMap) {
	let mvp = {};

	Object.entries(data.players).forEach(([key, value]) => {
		const {
			wins, loses, kdas, nws
		} = value;
		const kdaAvg = kdas.reduce((a, b) => a + b, 0) / kdas.length;
		const nwAvg = nws.reduce((a, b) => a + b, 0) / nws.length;
		const score = (wins + loses) * 1000 + kdaAvg * 100 + nwAvg;

		if (score > (mvp.score || 0)) {
			const { avatar, name} = playersMap[key];

			mvp = {
				avatar,
				name,
				score,
				wins,
				loses,
				kdaAvg,
				nwAvg
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
	sendPlayersWinrate,
	sendLastMatchStats,
	sendLastPlayTime,
	deleteMessage,
	deleteAction
};
