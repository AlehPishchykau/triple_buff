const fs = require('fs');
const path = require('path');
const chatScope = require('./chatScope');

function filePath() {
	return path.join(chatScope.chatDir(), 'players.json');
}

function load() {
	try {
		return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
	} catch {
		return {};
	}
}

function save(data) {
	fs.mkdirSync(path.dirname(filePath()), { recursive: true });
	fs.writeFileSync(filePath(), JSON.stringify(data, null, '\t'));
}

function register(dotaId, telegramId, telegram, name) {
	const data = load();
	data[String(dotaId)] = { telegramId, telegram, name };
	save(data);
}

function unregister(telegramId) {
	const data = load();
	const dotaId = Object.keys(data).find(id => data[id].telegramId === telegramId);
	if (!dotaId) return null;
	delete data[dotaId];
	save(data);
	return dotaId;
}

function getIds() {
	return Object.keys(load()).map(Number);
}

function getTelegramUsernames() {
	return Object.values(load()).map(p => p.telegram).filter(Boolean);
}

function getTelegramMap() {
	const map = {};
	for (const [dotaId, entry] of Object.entries(load())) {
		if (entry.telegram) map[Number(dotaId)] = entry.telegram;
	}
	return map;
}

module.exports = { load, save, register, unregister, getIds, getTelegramUsernames, getTelegramMap };
