const { PLAYERS_IDS, TURBO_ID } = require('./constants');
const { graphqlRequest } = require('./utils');

async function fetchMatchesData(period = 'yesterday') {
	const periods = {
		yesterday: 86400,
		today: 2 * 86400,
		week: 7 * 86400,
	};
	const startDateTime = Math.round(Date.now() / 1000 - (periods[period] || 86400));

	const playerQueries = PLAYERS_IDS.map((id, index) => `
		p${index}: player(steamAccountId: ${id}) {
			matches(request: { startDateTime: ${startDateTime} }) {
				id
				durationSeconds
				startDateTime
				endDateTime
				gameMode
				players(steamAccountId: ${id}) {
					steamAccountId
					kills
					deaths
					assists
					goldPerMinute
					experiencePerMinute
					networth
					isVictory
					heroId
					heroDamage
					towerDamage
					level
				}
			}
		}
	`).join('\n');

	const data = await graphqlRequest(`{ ${playerQueries} }`);

	return PLAYERS_IDS.map((_, index) => data[`p${index}`].matches);
}

async function fetchPlayersData() {
	const playerQueries = PLAYERS_IDS.map((id, index) => `
		p${index}: player(steamAccountId: ${id}) {
			steamAccount {
				id
				name
				avatar
			}
		}
	`).join('\n');

	const data = await graphqlRequest(`{ ${playerQueries} }`);

	const result = {};
	PLAYERS_IDS.forEach((_, index) => {
		const { id, avatar, name } = data[`p${index}`].steamAccount;
		result[id] = { avatar, name };
	});

	return result;
}

async function fetchPlayerData(playerId) {
	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			steamAccount {
				id
				name
				avatar
			}
		}
	}`);

	return data.player;
}

async function fetchLastMatchData(playerId, gameModeId) {
	const gameModeFilter = gameModeId ? `gameModeIds: [${gameModeId}],` : '';

	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			matches(request: { ${gameModeFilter} take: 1 }) {
				id
				durationSeconds
				startDateTime
				endDateTime
				gameMode
				players(steamAccountId: ${playerId}) {
					steamAccountId
					kills
					deaths
					assists
					goldPerMinute
					experiencePerMinute
					networth
					isVictory
					heroId
					heroDamage
					towerDamage
					level
				}
			}
		}
	}`);

	const matches = data.player.matches;
	return matches.length > 0 ? matches[0] : null;
}

async function fetchLastMatches(playerId, take = 10) {
	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			matches(request: { gameModeIds: [${TURBO_ID}], take: ${take} }) {
				id
				durationSeconds
				startDateTime
				endDateTime
				gameMode
				players(steamAccountId: ${playerId}) {
					steamAccountId
					kills
					deaths
					assists
					goldPerMinute
					experiencePerMinute
					networth
					isVictory
					heroId
					heroDamage
					towerDamage
					level
				}
			}
		}
	}`);
	return data.player.matches;
}

async function fetchPlayerMatchesStats(playerId) {
	const oneMonthAgo = Math.round(Date.now() / 1000 - 30 * 86400);

	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			allTime: matchesGroupBy(request: { 
				playerList: SINGLE,
				groupBy: GAME_MODE,
				gameModeIds: [${TURBO_ID}]
			}) {
				... on MatchGroupByGameModeType {
					gameMode
					matchCount
					winCount
				}
			}
			oneMonth: matchesGroupBy(request: { 
				playerList: SINGLE,
				groupBy: GAME_MODE,
				gameModeIds: [${TURBO_ID}],
				startDateTime: ${oneMonthAgo}
			}) {
				... on MatchGroupByGameModeType {
					gameMode
					matchCount
					winCount
				}
			}
		}
	}`);

	return data.player;
}

async function fetchPlayerHeroesStats(playerId) {
	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			heroesPerformance(request: { gameModeIds: [${TURBO_ID}] }) {
				heroId
				matchCount
				winCount
			}
		}
	}`);

	return data.player.heroesPerformance;
}

async function fetchGameModes() {
	const data = await graphqlRequest(`{
		constants {
			gameModes {
				id
				name
			}
		}
	}`);

	const result = {};
	data.constants.gameModes.forEach(mode => {
		result[mode.id] = mode;
	});
	return result;
}

async function fetchHeroes() {
	const data = await graphqlRequest(`{
		constants {
			heroes(language: ENGLISH) {
				id
				displayName
				shortName
			}
		}
	}`);

	const result = {};
	data.constants.heroes.forEach(hero => {
		result[hero.id] = hero;
	});
	return result;
}

async function fetchRecentMatches(playerId, take = 20) {
	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			matches(request: { gameModeIds: [${TURBO_ID}], take: ${take} }) {
				id
				startDateTime
				players(steamAccountId: ${playerId}) {
					isVictory
				}
			}
		}
	}`);
	return data.player.matches;
}

async function fetchRecentMatchesDetailed(playerId, take = 50) {
	const twoWeeksAgo = Math.round(Date.now() / 1000 - 14 * 86400);
	const data = await graphqlRequest(`{
		player(steamAccountId: ${playerId}) {
			matches(request: { gameModeIds: [${TURBO_ID}], startDateTime: ${twoWeeksAgo}, take: ${take} }) {
				id
				durationSeconds
				startDateTime
				players(steamAccountId: ${playerId}) {
					steamAccountId
					kills
					deaths
					assists
					networth
					isVictory
					heroId
				}
			}
		}
	}`);
	return data.player.matches;
}

module.exports = {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerData,
	fetchLastMatchData,
	fetchLastMatches,
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchRecentMatches,
	fetchRecentMatchesDetailed,
	fetchGameModes,
	fetchHeroes
};
