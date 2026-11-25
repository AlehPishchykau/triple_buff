const players = require('./players');
const { openDotaGet, openDotaPost, isTurbo } = require('./utils');

const TURBO_FILTER = 'game_mode=23&significant=0';

async function refreshPlayers() {
	const ids = players.getIds();
	await Promise.all(ids.map(id => openDotaPost(`/players/${id}/refresh`)));
}

async function fetchMatchesData(period = 'yesterday') {
	const ids = players.getIds();
	const periods = { yesterday: 1, today: 1, week: 7 };
	const days = periods[period] || 1;
	const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

	const results = await Promise.all(
		ids.map(id => openDotaGet(`/players/${id}/recentMatches`))
	);

	return results.map((matches, idx) =>
		matches
			.filter(m => isTurbo(m) && m.start_time >= cutoff)
			.map(m => ({ ...m, steamAccountId: ids[idx] }))
	);
}

async function fetchPlayersData() {
	const ids = players.getIds();
	const localData = players.load();
	const results = await Promise.all(
		ids.map(id => openDotaGet(`/players/${id}`))
	);

	const data = {};
	results.forEach(player => {
		const p = player.profile;
		const local = localData[String(p.account_id)];
		data[p.account_id] = { name: local?.name || p.personaname, nick: p.personaname, avatar: p.avatarfull };
	});
	return data;
}

async function fetchPlayerData(playerId) {
	const player = await openDotaGet(`/players/${playerId}`);
	const p = player.profile;
	return { name: p.personaname, avatar: p.avatarfull };
}

async function fetchPlayerMatchesStats(playerId) {
	const [allTime, oneMonth] = await Promise.all([
		openDotaGet(`/players/${playerId}/wl?${TURBO_FILTER}`),
		openDotaGet(`/players/${playerId}/wl?${TURBO_FILTER}&date=30`),
	]);

	return {
		allTime: { matchCount: allTime.win + allTime.lose, winCount: allTime.win },
		oneMonth: { matchCount: oneMonth.win + oneMonth.lose, winCount: oneMonth.win },
	};
}

async function fetchPlayerHeroesStats(playerId) {
	const heroes = await openDotaGet(`/players/${playerId}/heroes?${TURBO_FILTER}`);
	return heroes
		.filter(h => h.games > 0)
		.map(h => ({
			heroId: Number(h.hero_id),
			matchCount: h.games,
			winCount: h.win,
			lastPlayed: h.last_played,
		}));
}

const PLAYER_MATCH_FIELDS = [
	'hero_id', 'kills', 'deaths', 'assists', 'gold_per_min', 'xp_per_min', 'hero_damage',
	'tower_damage', 'hero_healing', 'last_hits', 'level', 'start_time', 'duration', 'party_size',
];

// Turbo match history with per-match stats; unlike /recentMatches it can go past the
// last 20 games and filter by hero or period.
async function fetchPlayerMatches(playerId, { heroId, days, limit = 20 } = {}) {
	const params = [TURBO_FILTER, `limit=${limit}`, ...PLAYER_MATCH_FIELDS.map(f => `project=${f}`)];
	if (heroId) params.push(`hero_id=${heroId}`);
	if (days) params.push(`date=${days}`);
	const matches = await openDotaGet(`/players/${playerId}/matches?${params.join('&')}`);
	return matches.sort((a, b) => b.start_time - a.start_time);
}

async function fetchRecentMatches(playerId, take = 20) {
	const matches = await openDotaGet(`/players/${playerId}/recentMatches`);
	return matches.filter(m => isTurbo(m)).slice(0, take);
}

async function fetchMatchDetail(matchId) {
	return openDotaGet(`/matches/${matchId}`);
}

async function fetchPeers(playerId, days) {
	const dateParam = days ? `&date=${days}` : '';
	const peers = await openDotaGet(`/players/${playerId}/peers?${TURBO_FILTER}${dateParam}`);
	return peers;
}

async function fetchHeroes() {
	const heroes = await openDotaGet('/constants/heroes');
	const result = {};
	Object.values(heroes).forEach(hero => {
		result[hero.id] = {
			id: hero.id,
			displayName: hero.localized_name,
			shortName: hero.name.replace('npc_dota_hero_', ''),
			roles: hero.roles || [],
			aliases: Array.isArray(hero.aliases) ? hero.aliases : [],
		};
	});
	return result;
}

// item id → display name
async function fetchItems() {
	const items = await openDotaGet('/constants/items');
	const result = {};
	Object.values(items).forEach(item => {
		if (item.id && item.dname) result[item.id] = item.dname;
	});
	return result;
}

async function fetchPlayerTotals(playerId, days) {
	const dateParam = days ? `&date=${days}` : '';
	return openDotaGet(`/players/${playerId}/totals?${TURBO_FILTER}${dateParam}`);
}

async function fetchGameModes() {
	return openDotaGet('/constants/game_mode');
}

module.exports = {
	refreshPlayers,
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerData,
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchRecentMatches,
	fetchMatchDetail,
	fetchPeers,
	fetchHeroes,
	fetchItems,
	fetchPlayerMatches,
	fetchPlayerTotals,
	fetchGameModes
};
