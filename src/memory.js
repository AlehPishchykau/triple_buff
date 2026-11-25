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

// facts.json: { global: [entry], users: { '@tag': [entry] }, nextId }
//   global — rules for how the bot should behave in this chat (with their scope in the text)
//   users  — lasting facts about a person, stored under the person they are about
// entry = { id, text, by?, ts? }. Older files hold plain strings; they get ids on first read.
function readFacts() {
	const raw = readJSON(factsPath(), { global: [], users: {} });
	const all = [...(raw.global || []), ...Object.values(raw.users || {}).flat()];
	const maxId = all.reduce((max, e) => Math.max(max, Number(String(e?.id || '').replace(/\D/g, '')) || 0), 0);
	let nextId = Math.max(raw.nextId || 1, maxId + 1);
	const entry = e => typeof e === 'string' ? { id: `m${nextId++}`, text: e } : e;
	const facts = { global: (raw.global || []).map(entry), users: {} };
	for (const [user, list] of Object.entries(raw.users || {})) facts.users[user] = list.map(entry);
	facts.nextId = nextId;
	return facts;
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

const MAX_RULES = 30;
const MAX_FACTS_PER_USER = 30;

function sameText(a, b) {
	const norm = t => String(t).toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
	return norm(a) === norm(b);
}

function listOf(facts, target) {
	return target === 'global' ? facts.global : facts.users[target];
}

function locate(facts, id) {
	for (const target of ['global', ...Object.keys(facts.users)]) {
		const index = listOf(facts, target).findIndex(e => e.id === id);
		if (index >= 0) return { target, list: listOf(facts, target), index };
	}
	return null;
}

// Returns the stored entry, or null when it is a duplicate or the list is full.
function addFact(target, text, meta = {}) {
	const f = readFacts();
	if (target !== 'global' && !f.users[target]) f.users[target] = [];
	const list = listOf(f, target);
	if (list.some(e => sameText(e.text, text))) return null;
	if (list.length >= (target === 'global' ? MAX_RULES : MAX_FACTS_PER_USER)) return null;
	const entry = { id: `m${f.nextId++}`, text, ...meta, ts: Math.floor(Date.now() / 1000) };
	list.push(entry);
	writeFacts(f);
	return entry;
}

// true — updated, false — no such entry, null — the text is the same as before.
function updateFact(id, text, meta = {}) {
	const f = readFacts();
	const found = locate(f, id);
	if (!found) return false;
	if (sameText(found.list[found.index].text, text)) return null; // nothing actually changes
	found.list[found.index] = { ...found.list[found.index], text, ...meta, ts: Math.floor(Date.now() / 1000) };
	writeFacts(f);
	return true;
}

// Returns the removed text, or null when there is no such entry.
function deleteFact(id) {
	const f = readFacts();
	const found = locate(f, id);
	if (!found) return null;
	const [removed] = found.list.splice(found.index, 1);
	writeFacts(f);
	return removed.text;
}

function getFactTargets() {
	return Object.keys(readFacts().users);
}

// Memory as shown to the models. `withIds` is for the memory keeper, which edits entries by id.
function getMemorySummary(username, { withIds = false, rules = true } = {}) {
	const f = readFacts();
	const line = e => `  ${withIds ? `[${e.id}] ` : '- '}${e.text}`;
	const lines = [];
	if (rules && f.global.length) {
		lines.push('ПРАВИЛА ЧАТА (соблюдай всегда; область действия указана в самом правиле):');
		f.global.forEach(e => lines.push(line(e)));
	}
	const people = Object.entries(f.users).filter(([, facts]) => facts.length);
	if (people.length) {
		lines.push('ФАКТЫ О ЛЮДЯХ (используй к месту, не пересказывай):');
		for (const [user, facts] of people) {
			lines.push(`${user}${user === username ? ' (собеседник)' : ''}:`);
			facts.forEach(e => lines.push(line(e)));
		}
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
	return { mood: s.mood, attitudes: s.attitudes, rules: f.global.length, facts: Object.values(f.users).flat().length };
}

module.exports = {
	getMood, setMood,
	getAttitude, setAttitude,
	addFact, updateFact, deleteFact, getFactTargets,
	getMemorySummary, getDebugData, savePhoto,
	saveChatMessage, getChatMessages,
	getVoiceTranscribe, setVoiceTranscribe,
	withFileLock,
};
