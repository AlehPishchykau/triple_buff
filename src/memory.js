const fs = require('fs');
const path = require('path');
const chatScope = require('./chatScope');
const persona = require('./persona');

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

function readJSON(filePath, defaults) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch {
		return defaults;
	}
}

function writeJSON(filePath, data) {
	ensureDir(path.dirname(filePath));
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getPersonaDir() {
	return chatScope.personaDir(persona.command);
}

function statePath() {
	return path.join(getPersonaDir(), 'state.json');
}

function factsPath() {
	return path.join(getPersonaDir(), 'facts.json');
}

function chatlogPath() {
	return path.join(chatScope.chatDir(), 'chatlog.json');
}

function readState() {
	return readJSON(statePath(), { mood: 30, attitudes: {} });
}

function writeState(data) {
	writeJSON(statePath(), data);
}

function readFacts() {
	return readJSON(factsPath(), { global: [], users: {} });
}

function writeFacts(data) {
	writeJSON(factsPath(), data);
}

function getMood() {
	return readState().mood;
}

function setMood(val) {
	const s = readState();
	s.mood = Math.max(1, Math.min(100, val));
	writeState(s);
	return s.mood;
}

function getAttitude(username) {
	return readState().attitudes[username] || 30;
}

function setAttitude(username, val) {
	const s = readState();
	s.attitudes[username] = Math.max(1, Math.min(100, val));
	writeState(s);
	return s.attitudes[username];
}

function getVoiceTranscribe() {
	return readState().voiceTranscribe || false;
}

function setVoiceTranscribe(enabled) {
	const s = readState();
	s.voiceTranscribe = enabled;
	writeState(s);
	return enabled;
}

function addFact(target, fact) {
	const f = readFacts();
	if (target === 'global') {
		f.global.push(fact);
	} else {
		if (!f.users[target]) f.users[target] = [];
		f.users[target].push(fact);
	}
	writeFacts(f);
}

function replaceFact(target, index, fact) {
	const f = readFacts();
	const arr = target === 'global' ? f.global : f.users[target];
	if (arr && index >= 0 && index < arr.length) {
		arr[index] = fact;
		writeFacts(f);
		return true;
	}
	return false;
}

function deleteFact(target, index) {
	const f = readFacts();
	const arr = target === 'global' ? f.global : f.users[target];
	if (arr && index >= 0 && index < arr.length) {
		const removed = arr.splice(index, 1)[0];
		writeFacts(f);
		return removed;
	}
	return null;
}

function getMemorySummary(username) {
	const f = readFacts();
	const lines = [];
	if (f.global.length) {
		lines.push('Общие факты:');
		f.global.forEach((fact, i) => lines.push(`  [${i}] ${fact}`));
	}
	for (const [user, facts] of Object.entries(f.users)) {
		if (!facts.length) continue;
		const isCurrent = user === username;
		lines.push(`${user}${isCurrent ? ' (собеседник)' : ''}:`);
		facts.forEach((fact, i) => lines.push(`  [${i}] ${fact}`));
	}
	return lines.join('\n') || null;
}

const CHATLOG_MAX_AGE = 7 * 86400;

function withFileLock(filePath, fn) {
	const lockDir = filePath + '.lock';
	ensureDir(path.dirname(filePath));
	const maxWait = 3000;
	const start = Date.now();
	while (true) {
		try {
			fs.mkdirSync(lockDir);
			break;
		} catch {
			if (Date.now() - start > maxWait) {
				fs.rmSync(lockDir, { recursive: true, force: true });
				fs.mkdirSync(lockDir);
				break;
			}
			const wait = Math.random() * 20 + 5;
			const end = Date.now() + wait;
			while (Date.now() < end) {}
		}
	}
	try {
		return fn();
	} finally {
		fs.rmSync(lockDir, { recursive: true, force: true });
	}
}

function saveChatMessage({ from, name, text, ts, type, msgId }) {
	const file = chatlogPath();
	withFileLock(file, () => {
		const log = readJSON(file, []);
		if (msgId && log.some(m => m.msgId === msgId)) return;
		log.push({ from, name, text, ts, type, ...(msgId ? { msgId } : {}) });
		const cutoff = Math.floor(Date.now() / 1000) - CHATLOG_MAX_AGE;
		writeJSON(file, log.filter(m => m.ts > cutoff));
	});
}

function getChatMessages(fromTs, toTs) {
	return readJSON(chatlogPath(), []).filter(m => m.ts >= fromTs && m.ts <= toTs);
}

const PHOTOS_DIR = path.join(chatScope.BASE_DIR, 'photos');

function savePhoto(filename, buffer) {
	ensureDir(PHOTOS_DIR);
	const filePath = path.join(PHOTOS_DIR, filename);
	fs.writeFileSync(filePath, buffer);
	return filePath;
}

function getDebugData() {
	const s = readState();
	const f = readFacts();
	return { mood: s.mood, attitudes: s.attitudes, globalFacts: f.global, userFacts: f.users };
}

module.exports = {
	getMood, setMood,
	getAttitude, setAttitude,
	addFact, replaceFact, deleteFact,
	getMemorySummary, getDebugData, savePhoto,
	saveChatMessage, getChatMessages,
	getVoiceTranscribe, setVoiceTranscribe,
};
