const { PLAYERS_IDS } = require('./constants');
const { openDotaGet, openDotaPost, isTurbo } = require('./utils');

const TURBO_FILTER = 'game_mode=23&significant=0';

async function refreshPlayers() {
	await Promise.all(
		PLAYERS_IDS.map(id => openDotaPost(`/players/${id}/refresh`))
	);
}

async function fetchMatchesData(period = 'yesterday') {
	const periods = { yesterday: 1, today: 1, week: 7 };
	const days = periods[period] || 1;
	const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

	const results = await Promise.all(
		PLAYERS_IDS.map(id => openDotaGet(`/players/${id}/recentMatches`))
	);

	return results.map((matches, idx) =>
		matches
			.filter(m => isTurbo(m) && m.start_time >= cutoff)
			.map(m => ({ ...m, steamAccountId: PLAYERS_IDS[idx] }))
	);
}

async function fetchPlayersData() {
	const results = await Promise.all(
		PLAYERS_IDS.map(id => openDotaGet(`/players/${id}`))
	);

	const data = {};
	results.forEach(player => {
		const p = player.profile;
		data[p.account_id] = { name: p.personaname, avatar: p.avatarfull };
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
		}));
}

async function fetchLastMatches(playerId, take = 5) {
	const matches = await openDotaGet(`/players/${playerId}/recentMatches`);
	return matches.filter(m => isTurbo(m)).slice(0, take);
}

async function fetchRecentMatches(playerId, take = 20) {
	const matches = await openDotaGet(`/players/${playerId}/recentMatches`);
	return matches.filter(m => isTurbo(m)).slice(0, take);
}

async function fetchMatchDetail(matchId) {
	return openDotaGet(`/matches/${matchId}`);
}

async function fetchLastMatchData(playerId) {
	const matches = await openDotaGet(`/players/${playerId}/recentMatches`);
	return matches.length > 0 ? matches[0] : null;
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
		};
	});
	return result;
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
	fetchLastMatches,
	fetchRecentMatches,
	fetchMatchDetail,
	fetchLastMatchData,
	fetchPeers,
	fetchHeroes,
	fetchGameModes
};
