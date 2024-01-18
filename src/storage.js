const { fetchPlayersData, fetchPlayerData, fetchHeroes, fetchGameModes } = require("./requests");

class Storage {
	players = null;
	heroes = null;
	gameModes = null;

	async getPlayers(force = false) {
		if (!this.players || force) {
			this.players = await fetchPlayersData();
		}

		return this.players;
	}

	async getPlayer(playerId) {
		if (!this.players) {
			this.players = await fetchPlayersData();
		}

		this.players[playerId] = await fetchPlayerData(playerId);

		return this.players[playerId];
	}

	async getHeroes(force = false) {
		if (!this.heroes || force) {
			this.heroes = await fetchHeroes();
		}

		return this.heroes;
	}

	async getGameModes(force = false) {
		if (!this.gameModes || force) {
			this.gameModes = await fetchGameModes();
		}

		return this.gameModes;
	}
}

const storage = new Storage();

module.exports = {
	storage
};