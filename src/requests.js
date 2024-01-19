const { PLAYERS_IDS } = require('./constants');
const { request } = require('./utils');

async function fetchMatchesData() {
	const startDateTime = Math.round(Date.now() / 1000 - 86400);
	const matchesRequests = [];

	PLAYERS_IDS.forEach((playerId) => {
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

	PLAYERS_IDS.forEach((playerId) => {
		const playerRequest = request(`Player/${playerId}`);

		playersRequests.push(playerRequest);
	})

	const responses = await Promise.all(playersRequests);
	const playersData = await Promise.all(responses.map(response => response.json()));
	const result = playersData.reduce((acc, value) => {
		const { id, avatar, name } = value.steamAccount;

		acc[id] = {
			avatar,
			name,
		};

		return acc;
	}, {});

	return result;
}

async function fetchPlayerData(playerId) {
	const response = await request(`Player/${playerId}`);

	return await response.json();
}

async function fetchLastMatchData(playerId) {
	const response = await request(`Player/${playerId}/matches?take=1&gameMode=23`);
	const matches = await response.json();

	return matches[0];
}

async function fetchPlayerMatchesStats(playerId) {
	const response = await request(`Player/${playerId}/summary`);

	return await response.json();
}

async function fetchPlayerHeroesStats(playerId) {
	const response = await request(`Player/${playerId}/heroPerformance?gameMode=23`);

	return await response.json();
}

async function fetchGameModes() {
	const response = await request(`GameMode`);

	return await response.json();
}

async function fetchHeroes() {
	const response = await request(`Hero`);

	return await response.json();
}

module.exports = {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerData,
	fetchLastMatchData,
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchGameModes,
	fetchHeroes
};
