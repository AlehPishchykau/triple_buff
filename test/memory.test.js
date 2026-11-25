const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/test_memory_' + Date.now();

process.env.DATA_DIR = TEST_DIR;
process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');

const chatScope = require('../src/chatScope');
const memory = require('../src/memory');

const CHAT_ID = '-1001234567890';

function withinChat(fn) {
	return chatScope.run(CHAT_ID, fn);
}

describe('memory', () => {
	beforeEach(() => {
		fs.mkdirSync(path.join(TEST_DIR, CHAT_ID, 'billy'), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
	});

	describe('mood', () => {
		it('returns default mood', () => {
			withinChat(() => {
				assert.equal(memory.getMood(), 30);
			});
		});

		it('sets and gets mood', () => {
			withinChat(() => {
				memory.setMood(60);
				assert.equal(memory.getMood(), 60);
			});
		});

		it('clamps mood to [1, 100]', () => {
			withinChat(() => {
				memory.setMood(200);
				assert.equal(memory.getMood(), 100);
				memory.setMood(-10);
				assert.equal(memory.getMood(), 1);
			});
		});
	});

	describe('attitudes', () => {
		it('returns default attitude', () => {
			withinChat(() => {
				assert.equal(memory.getAttitude('@user'), 30);
			});
		});

		it('sets and gets attitude', () => {
			withinChat(() => {
				memory.setAttitude('@user', 70);
				assert.equal(memory.getAttitude('@user'), 70);
			});
		});
	});

	describe('facts', () => {
		it('adds a rule to global and shows it in the rules section', () => {
			withinChat(() => {
				const entry = memory.addFact('global', 'Всегда отвечать коротко', { by: '@alice' });
				assert.ok(entry.id);
				assert.equal(entry.by, '@alice');
				const summary = memory.getMemorySummary();
				assert.ok(summary.includes('ПРАВИЛА ЧАТА'));
				assert.ok(summary.includes('- Всегда отвечать коротко'));
			});
		});

		it('adds a user fact and marks the interlocutor', () => {
			withinChat(() => {
				memory.addFact('@alice', 'likes cats');
				const summary = memory.getMemorySummary('@alice');
				assert.ok(summary.includes('ФАКТЫ О ЛЮДЯХ'));
				assert.ok(summary.includes('@alice (собеседник):'));
				assert.ok(summary.includes('likes cats'));
				assert.deepEqual(memory.getFactTargets(), ['@alice']);
			});
		});

		it('refuses duplicates that differ only in case or punctuation', () => {
			withinChat(() => {
				assert.ok(memory.addFact('@alice', 'Ездит на мопеде'));
				assert.equal(memory.addFact('@alice', 'ездит на мопеде.'), null);
				assert.ok(memory.addFact('@bob', 'Ездит на мопеде'));
			});
		});

		it('updates and deletes by stable id', () => {
			withinChat(() => {
				const a = memory.addFact('global', 'first');
				const b = memory.addFact('global', 'second');
				assert.equal(memory.deleteFact(a.id), 'first');
				assert.equal(memory.updateFact(b.id, 'second, updated'), true);
				const summary = memory.getMemorySummary(null, { withIds: true });
				assert.ok(summary.includes(`[${b.id}] second, updated`));
				assert.ok(!summary.includes('first'));
				assert.equal(memory.deleteFact('nope'), null);
				assert.equal(memory.updateFact('nope', 'x'), false);
			});
		});

		it('reads the old plain-string format and keeps ids stable across writes', () => {
			withinChat(() => {
				const file = path.join(TEST_DIR, CHAT_ID, 'billy', 'facts.json');
				fs.writeFileSync(file, JSON.stringify({ global: ['old rule'], users: { '@alice': ['old fact'] } }));
				const before = memory.getMemorySummary(null, { withIds: true });
				assert.ok(before.includes('[m1] old rule'));
				assert.ok(before.includes('[m2] old fact'));
				const added = memory.addFact('@alice', 'new fact');
				assert.equal(added.id, 'm3');
				const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
				assert.deepEqual(stored.global[0], { id: 'm1', text: 'old rule' });
				assert.equal(memory.deleteFact('m2'), 'old fact');
			});
		});

		it('can leave rules out of the summary', () => {
			withinChat(() => {
				memory.addFact('global', 'a rule');
				memory.addFact('@alice', 'a fact');
				const summary = memory.getMemorySummary(null, { rules: false });
				assert.ok(!summary.includes('a rule'));
				assert.ok(summary.includes('a fact'));
			});
		});

		it('returns null for empty summary', () => {
			withinChat(() => {
				assert.equal(memory.getMemorySummary(), null);
			});
		});
	});

	describe('chatlog', () => {
		it('saves the first message of a chat whose directory does not exist yet', () => {
			chatScope.run('-4118387787', () => {
				const now = Math.floor(Date.now() / 1000);
				memory.saveChatMessage({ from: '@a', name: 'A', text: 'first', ts: now, type: 'text' });
				assert.equal(memory.getChatMessages(now - 1, now + 1).length, 1);
			});
		});

		it('saves and retrieves messages', () => {
			withinChat(() => {
				const now = Math.floor(Date.now() / 1000);
				memory.saveChatMessage({ from: '@alice', name: 'Alice', text: 'hello', ts: now, type: 'text' });
				memory.saveChatMessage({ from: '@bob', name: 'Bob', text: 'hi', ts: now + 1, type: 'text' });
				const messages = memory.getChatMessages(now - 10, now + 10);
				assert.equal(messages.length, 2);
				assert.equal(messages[0].text, 'hello');
				assert.equal(messages[1].text, 'hi');
			});
		});

		it('filters by time range', () => {
			withinChat(() => {
				const now = Math.floor(Date.now() / 1000);
				memory.saveChatMessage({ from: '@a', name: 'A', text: 'old', ts: now - 20, type: 'text' });
				memory.saveChatMessage({ from: '@b', name: 'B', text: 'new', ts: now - 10, type: 'text' });
				const messages = memory.getChatMessages(now - 15, now);
				assert.equal(messages.length, 1);
				assert.equal(messages[0].text, 'new');
			});
		});

		it('handles bot message type', () => {
			withinChat(() => {
				const now = Math.floor(Date.now() / 1000);
				memory.saveChatMessage({ from: 'billy', name: 'Billy', text: 'bot reply', ts: now, type: 'bot' });
				const messages = memory.getChatMessages(now - 10, now + 10);
				assert.equal(messages.length, 1);
				assert.equal(messages[0].type, 'bot');
			});
		});
	});

	describe('voiceTranscribe', () => {
		it('defaults to false', () => {
			withinChat(() => {
				assert.equal(memory.getVoiceTranscribe(), false);
			});
		});

		it('toggles', () => {
			withinChat(() => {
				memory.setVoiceTranscribe(true);
				assert.equal(memory.getVoiceTranscribe(), true);
				memory.setVoiceTranscribe(false);
				assert.equal(memory.getVoiceTranscribe(), false);
			});
		});
	});
});
