const { TURBO_ID, PLAYERS_IDS } = require('./constants');
const {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchLastMatchData,
	fetchLastMatches,
	fetchRecentMatches,
	fetchRecentMatchesDetailed
} = require('./requests');
const { storage } = require('./storage');
const { secondsToTime, convertMiliseconds } = require('./utils');

const PERIOD_LABELS = {
	yesterday: 'Вчерашние матчи',
	today: 'Матчи за последние 2 дня',
	week: 'Матчи за неделю',
};

async function sendReport(ctx, period = 'yesterday') {
	const matchesData = await fetchMatchesData(period);
	const playersData = await fetchPlayersData();
	const heroes = await storage.getHeroes();

	const parsedMatchesData = parseMatchesData(matchesData);

	const summary = getSummary(parsedMatchesData, playersData, period);
	const mvp = getMVP(parsedMatchesData, playersData);
	const awards = getAwards(parsedMatchesData, playersData, heroes);

	await sendMatchesSummary(ctx, summary);
	await sendMVP(ctx, mvp);
	if (awards) {
		await ctx.replyWithHTML(awards);
	}

	const playedIds = Object.keys(parsedMatchesData.players);
	if (playedIds.length > 0) {
		const heroStatsResponses = await Promise.all(
			playedIds.map(id => fetchPlayerHeroesStats(id))
		);
		const lines = heroStatsResponses.map((heroPerf, index) => {
			const pid = playedIds[index];
			const name = playersData[pid]?.name || 'Unknown';
			if (!heroPerf || !heroPerf.length) return `<b>${name}</b>: нет данных`;
			const top = heroPerf.sort((a, b) => b.matchCount - a.matchCount)[0];
			const hero = heroes[top.heroId]?.displayName || '???';
			const wr = ((top.winCount / top.matchCount) * 100).toFixed(1);
			return `<b>${name}</b>: ${hero} (${top.matchCount} игр, ${wr}%)`;
		});
		await ctx.replyWithHTML(`<blockquote><b>Любимые герои</b>\n${lines.join('\n')}</blockquote>`);
	}
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

	const playersStats = response.map((playerData, index) => {
		const turboStats = playerData[period];
		const turboMatchesStats = turboStats.find((m) => m.gameMode === TURBO_ID);

		if (!turboMatchesStats || turboMatchesStats.matchCount === 0) {
			return `
			<b>${players[index].name}</b>
			No turbo matches
		`;
		}

		return `
			<b>${players[index].name}</b>
			Matches: ${turboMatchesStats.matchCount}
			Winrate: ${(turboMatchesStats.winCount / turboMatchesStats.matchCount * 100).toFixed(1)}%
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
	const playerData = await fetchPlayerMatchesStats(playerId);
	const turboStats = playerData[period];
	const turboMatchesStats = turboStats.find((m) => m.gameMode === TURBO_ID);

	if (!players[playerId]) {
		return;
	}

	if (!turboMatchesStats || turboMatchesStats.matchCount === 0) {
		const message = `
		<blockquote>
		<b>${players[playerId].name}</b>
		No turbo matches found
		</blockquote>
	`;
		await ctx.replyWithHTML(message);
		return;
	}

	const periodString = period === 'allTime' ? 'All time' : 'Last month';

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b>

		${periodString} turbo matches: ${turboMatchesStats.matchCount}
		Winrate: ${(turboMatchesStats.winCount / turboMatchesStats.matchCount * 100).toFixed(1)}%
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
		KDA: ${lastMatchPlayerData.kills} - ${lastMatchPlayerData.deaths} - ${lastMatchPlayerData.assists}
		Networth: ${lastMatchPlayerData.networth}
		Level: ${lastMatchPlayerData.level}

		Hero DMG: ${lastMatchPlayerData.heroDamage}
		Tower DMG: ${lastMatchPlayerData.towerDamage}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchesList(ctx) {
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchLastMatches(id, 5)));

	const allMatches = [];
	responses.forEach((matches, idx) => {
		if (!matches) return;
		matches.forEach(match => {
			const player = match.players[0];
			allMatches.push({
				matchId: match.id,
				playerId: playerIds[idx],
				playerName: playersMap[playerIds[idx]].name,
				heroName: heroes[player.heroId]?.displayName || '???',
				isVictory: player.isVictory,
				kills: player.kills,
				deaths: player.deaths,
				assists: player.assists,
				startDateTime: match.startDateTime,
			});
		});
	});

	allMatches.sort((a, b) => b.startDateTime - a.startDateTime);
	const top10 = allMatches.slice(0, 10);

	if (!top10.length) {
		await ctx.replyWithHTML('<blockquote>Нет недавних матчей</blockquote>');
		return;
	}

	return { matches: top10 };
}

async function sendMatchDetails(ctx, matchId, playerId) {
	const players = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const matches = await fetchLastMatches(playerId, 20);
	const match = matches.find(m => m.id === Number(matchId));

	if (!match || !players[playerId]) return;

	const p = match.players[0];
	const hero = heroes[p.heroId];

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b> <a href="https://www.dotabuff.com/matches/${match.id}">${p.isVictory ? 'won' : 'lost'} on ${hero?.displayName || '???'}</a>
		${(new Date(match.startDateTime * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		Duration: ${secondsToTime(match.durationSeconds)}
		KDA: ${p.kills} - ${p.deaths} - ${p.assists}
		Networth: ${p.networth}
		Level: ${p.level}

		Hero DMG: ${p.heroDamage}
		Tower DMG: ${p.towerDamage}
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
		if (!matchData) {
			return `${players[index].name}: no matches found`;
		}
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
		},
		awards: {
			feeder: { steamAccountId: null, value: 0, heroId: null },
			farmer: { steamAccountId: null, value: 0, heroId: null },
			destroyer: { steamAccountId: null, value: 0, heroId: null },
			carry: { steamAccountId: null, value: 0, heroId: null },
		}
	};

	matchesByPlayer.forEach((playerMatches) => {
		playerMatches.forEach((match) => {
			const player = match.players[0];
			const {
				steamAccountId,
				kills,
				deaths,
				assists,
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

			result.players[steamAccountId].kdas.push((kills + assists) / (deaths || 1));
			result.players[steamAccountId].gpms.push(goldPerMinute);
			result.players[steamAccountId].xpms.push(experiencePerMinute);
			result.players[steamAccountId].nws.push(networth);

			const heroId = player.heroId;
			if (deaths > result.awards.feeder.value) {
				result.awards.feeder = { steamAccountId, value: deaths, heroId };
			}
			if (goldPerMinute > result.awards.farmer.value) {
				result.awards.farmer = { steamAccountId, value: goldPerMinute, heroId };
			}
			if (player.towerDamage > result.awards.destroyer.value) {
				result.awards.destroyer = { steamAccountId, value: player.towerDamage, heroId };
			}
			if (networth > result.awards.carry.value) {
				result.awards.carry = { steamAccountId, value: networth, heroId };
			}

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

function getSummary(data, playersMap, period = 'yesterday') {
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

	let message = `<blockquote><b>${PERIOD_LABELS[period] || PERIOD_LABELS.yesterday}</b>\n\n`;

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
		const totalGames = wins + loses;
		const winrate = totalGames > 0 ? wins / totalGames : 0;
		const kdaAvg = kdas.reduce((a, b) => a + b, 0) / kdas.length;
		const nwAvg = nws.reduce((a, b) => a + b, 0) / nws.length;
		const score = winrate * 50 + kdaAvg * 10 + nwAvg / 500 + totalGames * 2;

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

function getAwards(data, playersMap, heroes) {
	const { awards } = data;
	if (!awards.feeder.steamAccountId) return null;

	const AWARD_CONFIG = [
		{ key: 'feeder', label: 'Фидер', unit: 'смертей' },
		{ key: 'farmer', label: 'Фармер', unit: 'GPM' },
		{ key: 'destroyer', label: 'Разрушитель', unit: 'tower dmg' },
		{ key: 'carry', label: 'Керри', unit: 'networth' },
	];

	const lines = AWARD_CONFIG.map(({ key, label, unit }) => {
		const award = awards[key];
		const name = playersMap[award.steamAccountId]?.name || 'Unknown';
		const hero = heroes[award.heroId]?.displayName || '';
		return `<b>${label}</b>: ${name} (${hero}, ${award.value} ${unit})`;
	});

	return `<blockquote><b>Награды</b>\n${lines.join('\n')}</blockquote>`;
}

async function sendHeroesStats(ctx) {
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchPlayerHeroesStats(id)));

	const playerStats = responses.map((heroPerf, index) => {
		const name = playersMap[playerIds[index]].name;
		if (!heroPerf || !heroPerf.length) return `<b>${name}</b>: нет данных`;
		const sorted = heroPerf.sort((a, b) => b.matchCount - a.matchCount).slice(0, 3);
		const heroLines = sorted.map((h, i) => {
			const wr = ((h.winCount / h.matchCount) * 100).toFixed(1);
			return `  ${i + 1}. ${heroes[h.heroId]?.displayName || '???'} — ${h.matchCount} игр, ${wr}%`;
		}).join('\n');
		return `<b>${name}</b>\n${heroLines}`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Топ-3 героев (турбо)</b>\n\n${playerStats.join('\n\n')}</blockquote>`);
}

async function sendStreaks(ctx) {
	const playersMap = await storage.getPlayers();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchRecentMatches(id)));

	const streakLines = responses.map((matches, index) => {
		const name = playersMap[playerIds[index]].name;
		if (!matches || !matches.length) return `${name}: нет матчей`;

		const firstResult = matches[0].players[0].isVictory;
		let count = 0;
		for (const match of matches) {
			if (match.players[0].isVictory === firstResult) {
				count++;
			} else {
				break;
			}
		}
		const type = firstResult ? 'побед' : 'поражений';
		const emoji = firstResult ? '🟢' : '🔴';
		return `${emoji} ${name}: ${count} ${type} подряд`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Текущие серии</b>\n\n${streakLines.join('\n')}</blockquote>`);
}

async function sendPartyStats(ctx) {
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchRecentMatchesDetailed(id)));

	const matchMap = {};
	responses.forEach((matches, idx) => {
		const pid = playerIds[idx];
		if (!matches) return;
		matches.forEach(match => {
			if (!matchMap[match.id]) {
				matchMap[match.id] = { match, players: [] };
			}
			matchMap[match.id].players.push({
				playerId: pid,
				data: match.players[0]
			});
		});
	});

	const partyMatches = Object.values(matchMap).filter(m => m.players.length >= 2);

	if (!partyMatches.length) {
		await ctx.replyWithHTML('<blockquote>Нет совместных матчей за последние 2 недели</blockquote>');
		return;
	}

	const totalGames = partyMatches.length;
	const wins = partyMatches.filter(m => m.players[0].data.isVictory).length;
	const winrate = ((wins / totalGames) * 100).toFixed(1);

	const playerPartyStats = {};
	partyMatches.forEach(pm => {
		pm.players.forEach(p => {
			if (!playerPartyStats[p.playerId]) {
				playerPartyStats[p.playerId] = { games: 0, wins: 0 };
			}
			playerPartyStats[p.playerId].games++;
			if (p.data.isVictory) playerPartyStats[p.playerId].wins++;
		});
	});

	const lines = Object.entries(playerPartyStats)
		.sort((a, b) => b[1].games - a[1].games)
		.map(([pid, stats]) => {
			const wr = ((stats.wins / stats.games) * 100).toFixed(1);
			return `${playersMap[pid]?.name || pid}: ${stats.games} игр, ${wr}% WR`;
		});

	const message = `<blockquote><b>Совместные игры (2 недели)</b>
Всего: ${totalGames} игр
Винрейт: ${winrate}%

${lines.join('\n')}
</blockquote>`;

	await ctx.replyWithHTML(message);
}

module.exports = {
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
	deleteAction
};
