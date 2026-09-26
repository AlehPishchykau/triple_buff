const { isWin, secondsToTime } = require('./utils');

const PERIOD_LABELS = {
	yesterday: 'Вчерашние матчи',
	today: 'Матчи за сутки',
	week: 'Матчи за неделю',
};

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
					wins: 0, loses: 0, kdas: [], gpms: [], xpms: [], nws: [], matches: []
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

			result.players[steamAccountId].matches.push({
				heroId: m.hero_id,
				kills: m.kills,
				deaths: m.deaths,
				assists: m.assists,
				gpm: m.gold_per_min,
				xpm: m.xp_per_min,
				heroDamage: m.hero_damage || 0,
				towerDamage: m.tower_damage || 0,
				heroHealing: m.hero_healing || 0,
				lastHits: m.last_hits || 0,
				duration: m.duration,
				won,
			});

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
			stats.topKDA = { name: playersMap[key].name, value: maxKDA };
		}
		if (maxNW > (stats.topNW?.value || 0)) {
			stats.topNW = { name: playersMap[key].name, value: maxNW };
		}
		if (maxGPM > (stats.topGPM?.value || 0)) {
			stats.topGPM = { name: playersMap[key].name, value: maxGPM };
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
		const { wins, loses, kdas, nws } = value;
		const totalGames = wins + loses;
		const winrate = totalGames > 0 ? wins / totalGames : 0;
		const kdaAvg = kdas.reduce((a, b) => a + b, 0) / kdas.length;
		const nwAvg = nws.reduce((a, b) => a + b, 0) / nws.length;
		const score = winrate * 50 + kdaAvg * 10 + nwAvg / 500 + totalGames * 2;

		if (score > (mvp.score || 0)) {
			const { avatar, name } = playersMap[key];
			mvp = { avatar, name, score, wins, loses, kdaAvg, nwAvg };
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

module.exports = { PERIOD_LABELS, parseMatchesData, getSummary, getMVP, getAwards };
