const { fetchPlayersData, fetchPlayerData, fetchHeroes, fetchGameModes } = require("./requests");
const chatScope = require("./chatScope");

class Storage {
	_players = new Map();
	heroes = null;
	gameModes = null;

	async getPlayers(force = false) {
		const chatId = chatScope.getChatId();
		if (!this._players.has(chatId) || force) {
			this._players.set(chatId, await fetchPlayersData());
		}
		return this._players.get(chatId);
	}

	invalidatePlayers() {
		const chatId = chatScope.getChatId();
		if (chatId) this._players.delete(chatId);
	}

	async getPlayer(playerId) {
		const chatId = chatScope.getChatId();
		if (!this._players.has(chatId)) {
			this._players.set(chatId, await fetchPlayersData());
		}
		const players = this._players.get(chatId);
		players[playerId] = await fetchPlayerData(playerId);
		return players[playerId];
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

module.exports = { storage };
