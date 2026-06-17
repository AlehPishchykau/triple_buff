const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.env.HOME || '/root', 'data', 'triple_buff');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const FACTS_PATH = path.join(DATA_DIR, 'facts.json');

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

function readState() {
	return readJSON(STATE_PATH, { mood: 5, attitudes: {} });
}

function writeState(data) {
	writeJSON(STATE_PATH, data);
}

function readFacts() {
	return readJSON(FACTS_PATH, { global: [], users: {} });
}

function writeFacts(data) {
	writeJSON(FACTS_PATH, data);
}

function getMood() {
	return readState().mood;
}

function setMood(val) {
	const s = readState();
	s.mood = Math.max(1, Math.min(10, val));
	writeState(s);
	return s.mood;
}

function getAttitude(username) {
	return readState().attitudes[username] || 5;
}

function setAttitude(username, val) {
	const s = readState();
	s.attitudes[username] = Math.max(1, Math.min(10, val));
	writeState(s);
	return s.attitudes[username];
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

function getDebugData() {
	const s = readState();
	const f = readFacts();
	return { mood: s.mood, attitudes: s.attitudes, globalFacts: f.global, userFacts: f.users };
}

module.exports = {
	getMood, setMood,
	getAttitude, setAttitude,
	addFact, replaceFact, deleteFact,
	getMemorySummary, getDebugData,
};
