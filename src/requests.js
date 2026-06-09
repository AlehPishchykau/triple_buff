const { PLAYERS_IDS, LOBBY_TYPE_TURBO } = require('./constants');
const { openDotaGet, openDotaPost, isTurbo } = require('./utils');

async function refreshPlayers() {
	await Promise.all(
		PLAYERS_IDS.map(id => openDotaPost(`/players/${id}/refresh`))
	);
}

async function fetchMatchesData(period = 'yesterday') {
	const periods = { yesterday: 1, today: 2, week: 7 };
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
		openDotaGet(`/players/${playerId}/wl?lobby_type=${LOBBY_TYPE_TURBO}`),
		openDotaGet(`/players/${playerId}/wl?lobby_type=${LOBBY_TYPE_TURBO}&date=30`),
	]);

	return {
		allTime: { matchCount: allTime.win + allTime.lose, winCount: allTime.win },
		oneMonth: { matchCount: oneMonth.win + oneMonth.lose, winCount: oneMonth.win },
	};
}

async function fetchPlayerHeroesStats(playerId) {
	const heroes = await openDotaGet(`/players/${playerId}/heroes?lobby_type=${LOBBY_TYPE_TURBO}`);
	return heroes.map(h => ({
		heroId: Number(h.hero_id),
		matchCount: h.games,
		winCount: h.win,
	}));
}

async function fetchLastMatches(playerId, take = 5) {
	return openDotaGet(`/players/${playerId}/matches?lobby_type=${LOBBY_TYPE_TURBO}&limit=${take}`);
}

async function fetchRecentMatches(playerId, take = 20) {
	return openDotaGet(`/players/${playerId}/matches?lobby_type=${LOBBY_TYPE_TURBO}&limit=${take}`);
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
	return openDotaGet(`/players/${playerId}/peers?lobby_type=${LOBBY_TYPE_TURBO}${dateParam}`);
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
