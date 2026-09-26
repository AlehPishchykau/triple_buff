const { AsyncLocalStorage } = require('async_hooks');
const fs = require('fs');
const path = require('path');

const asyncStore = new AsyncLocalStorage();
const BASE_DIR = process.env.DATA_DIR || './data';

function run(chatId, fn) {
	return asyncStore.run(String(chatId), fn);
}

function getChatId() {
	return asyncStore.getStore();
}

function chatDir(chatId) {
	const id = chatId || getChatId();
	if (!id) throw new Error('No chat context');
	return path.join(BASE_DIR, String(id));
}

function personaDir(personaCommand, chatId) {
	return path.join(chatDir(chatId), personaCommand);
}

function listChatIds() {
	try {
		return fs.readdirSync(BASE_DIR, { withFileTypes: true })
			.filter(d => d.isDirectory() && /^-?\d+$/.test(d.name))
			.map(d => d.name);
	} catch {
		return [];
	}
}

module.exports = { run, getChatId, chatDir, personaDir, listChatIds, BASE_DIR };
