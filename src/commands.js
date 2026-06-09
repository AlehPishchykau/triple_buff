const { PLAYERS_IDS } = require('./constants');
const {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchLastMatches,
	fetchRecentMatches,
	fetchMatchDetail,
	fetchLastMatchData,
	fetchPeers,
} = require('./requests');
const { storage } = require('./storage');
const { secondsToTime, convertMiliseconds, isWin } = require('./utils');

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
		await ctx.replyWithHTML(`<blockquote><b>Любимые герои (за все время)</b>\n${lines.join('\n')}</blockquote>`);
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
	const requests = Object.keys(playersMap).map(id => fetchPlayerMatchesStats(id));
	const response = await Promise.all(requests);
	const periodString = period === 'allTime' ? 'All time' : 'Last month';
	const players = Object.values(playersMap);

	const playersStats = response.map((stats, index) => {
		const turboStats = stats[period];

		if (!turboStats || turboStats.matchCount === 0) {
			return `
			<b>${players[index].name}</b>
			No turbo matches
		`;
		}

		return `
			<b>${players[index].name}</b>
			Matches: ${turboStats.matchCount}
			Winrate: ${(turboStats.winCount / turboStats.matchCount * 100).toFixed(1)}%
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
	const stats = await fetchPlayerMatchesStats(playerId);
	const turboStats = stats[period];

	if (!players[playerId]) {
		return;
	}

	if (!turboStats || turboStats.matchCount === 0) {
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

		${periodString} turbo matches: ${turboStats.matchCount}
		Winrate: ${(turboStats.winCount / turboStats.matchCount * 100).toFixed(1)}%
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchStats(ctx, playerId) {
	const players = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const matches = await fetchLastMatches(playerId, 1);

	if (!matches.length || !players[playerId]) {
		return;
	}

	const match = matches[0];
	const won = isWin(match);
	const hero = heroes[match.hero_id];

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b> <a href="https://www.dotabuff.com/matches/${match.match_id}">${won ? 'won' : 'lost'} last match on ${hero?.displayName || '???'}</a>
		${(new Date(match.start_time * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		Duration: ${secondsToTime(match.duration)}
		KDA: ${match.kills} - ${match.deaths} - ${match.assists}
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
			allMatches.push({
				matchId: match.match_id,
				playerId: playerIds[idx],
				playerName: playersMap[playerIds[idx]].name,
				heroName: heroes[match.hero_id]?.displayName || '???',
				isVictory: isWin(match),
				kills: match.kills,
				deaths: match.deaths,
				assists: match.assists,
				startDateTime: match.start_time,
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
	const match = await fetchMatchDetail(matchId);

	if (!match || !players[playerId]) return;

	const p = match.players.find(pl => pl.account_id === Number(playerId));
	if (!p) return;

	const hero = heroes[p.hero_id];
	const won = p.radiant_win === (p.player_slot < 128);

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b> <a href="https://www.dotabuff.com/matches/${match.match_id}">${won ? 'won' : 'lost'} on ${hero?.displayName || '???'}</a>
		${(new Date(match.start_time * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		Duration: ${secondsToTime(match.duration)}
		KDA: ${p.kills} - ${p.deaths} - ${p.assists}
		Networth: ${p.net_worth || p.total_gold || 'N/A'}
		Level: ${p.level}

		Hero DMG: ${p.hero_damage}
		Tower DMG: ${p.tower_damage}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastPlayTime(ctx) {
	const playersMap = await storage.getPlayers();
	const requests = Object.keys(playersMap).map(id => fetchLastMatchData(id));
	const response = await Promise.all(requests);
	const players = Object.values(playersMap);

	const timeStats = response.map((match, index) => {
		if (!match) {
			return `${players[index].name}: no matches found`;
		}
		const endTime = (match.start_time + match.duration) * 1000;
		const time = Date.now() - endTime;
		return `${players[index].name}: ${convertMiliseconds(time)}`;
	});

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
		playerMatches.forEach((m) => {
			const steamAccountId = m.steamAccountId;
			const won = isWin(m);
			const networth = Math.round(m.gold_per_min * m.duration / 60);

			if (!result.players[steamAccountId]) {
				result.players[steamAccountId] = {
					wins: 0, loses: 0, kdas: [], gpms: [], xpms: [], nws: []
				};
			}

			if (won) {
				result.players[steamAccountId].wins++;
				result.summary.wins[m.match_id] = true;
			} else {
				result.players[steamAccountId].loses++;
				result.summary.loses[m.match_id] = true;
			}

			result.players[steamAccountId].kdas.push((m.kills + m.assists) / (m.deaths || 1));
			result.players[steamAccountId].gpms.push(m.gold_per_min);
			result.players[steamAccountId].xpms.push(m.xp_per_min);
			result.players[steamAccountId].nws.push(networth);

			if (m.deaths > result.awards.feeder.value) {
				result.awards.feeder = { steamAccountId, value: m.deaths, heroId: m.hero_id };
			}
			if (m.gold_per_min > result.awards.farmer.value) {
				result.awards.farmer = { steamAccountId, value: m.gold_per_min, heroId: m.hero_id };
			}
			if (m.tower_damage > result.awards.destroyer.value) {
				result.awards.destroyer = { steamAccountId, value: m.tower_damage, heroId: m.hero_id };
			}
			if (networth > result.awards.carry.value) {
				result.awards.carry = { steamAccountId, value: networth, heroId: m.hero_id };
			}

			if (m.duration > result.summary.longestMatchDuration) {
				result.summary.longestMatchDuration = m.duration;
			}

			if (m.duration < result.summary.shortestMatchDuration) {
				result.summary.shortestMatchDuration = m.duration;
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
		const minGames = 5;
		const withEnoughGames = heroPerf.filter(h => h.matchCount >= minGames);
		const pool = withEnoughGames.length >= 3 ? withEnoughGames : heroPerf;
		const sorted = pool.sort((a, b) => {
			const wrA = a.winCount / a.matchCount;
			const wrB = b.winCount / b.matchCount;
			return wrB - wrA || b.matchCount - a.matchCount;
		}).slice(0, 3);
		const heroLines = sorted.map((h, i) => {
			const wr = ((h.winCount / h.matchCount) * 100).toFixed(1);
			return `  ${i + 1}. ${heroes[h.heroId]?.displayName || '???'} — ${wr}% (${h.matchCount} игр)`;
		}).join('\n');
		return `<b>${name}</b>\n${heroLines}`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Топ-3 героев в турбо (за все время)</b>\n\n${playerStats.join('\n\n')}</blockquote>`);
}

async function sendStreaks(ctx) {
	const playersMap = await storage.getPlayers();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchRecentMatches(id)));

	const streakLines = responses.map((matches, index) => {
		const name = playersMap[playerIds[index]].name;
		if (!matches || !matches.length) return `${name}: нет матчей`;

		const firstResult = isWin(matches[0]);
		let count = 0;
		for (const match of matches) {
			if (isWin(match) === firstResult) {
				count++;
			} else {
				break;
			}
		}
		const type = firstResult ? 'побед' : 'поражений';
		const emoji = firstResult ? '🟢' : '🔴';
		return `${emoji} ${name}: ${count} ${type} подряд`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Текущие серии (последние 20 матчей)</b>\n\n${streakLines.join('\n')}</blockquote>`);
}

async function sendPartyStats(ctx) {
	const playersMap = await storage.getPlayers();
	const playerIds = Object.keys(playersMap);
	const trackedSet = new Set(playerIds.map(Number));

	const responses = [];
	for (const id of playerIds) {
		try {
			responses.push(await fetchPeers(id, 30));
		} catch (_) {
			responses.push([]);
		}
	}

	const pairStats = {};
	responses.forEach((peers, idx) => {
		const pid = playerIds[idx];
		if (!peers) return;
		peers.forEach(peer => {
			if (trackedSet.has(peer.account_id)) {
				const key = [pid, String(peer.account_id)].sort().join(':');
				if (!pairStats[key]) {
					pairStats[key] = { games: 0, wins: 0, players: [pid, String(peer.account_id)] };
				}
				pairStats[key].games = Math.max(pairStats[key].games, peer.games);
				pairStats[key].wins = Math.max(pairStats[key].wins, peer.win);
			}
		});
	});

	const pairs = Object.values(pairStats).filter(p => p.games > 0).sort((a, b) => b.games - a.games);

	if (!pairs.length) {
		await ctx.replyWithHTML('<blockquote>Нет совместных матчей в турбо за месяц</blockquote>');
		return;
	}

	const lines = pairs.slice(0, 15).map(p => {
		const name1 = playersMap[p.players[0]]?.name || p.players[0];
		const name2 = playersMap[p.players[1]]?.name || p.players[1];
		const wr = ((p.wins / p.games) * 100).toFixed(1);
		return `${name1} + ${name2}: ${p.games} игр, ${wr}% WR`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Совместные игры в турбо (месяц)</b>\n\n${lines.join('\n')}</blockquote>`);
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
