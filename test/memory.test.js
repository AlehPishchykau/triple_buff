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
		it('adds global fact', () => {
			withinChat(() => {
				memory.addFact('global', 'test fact');
				const summary = memory.getMemorySummary();
				assert.ok(summary.includes('test fact'));
			});
		});

		it('adds user fact', () => {
			withinChat(() => {
				memory.addFact('@alice', 'likes cats');
				const summary = memory.getMemorySummary('@alice');
				assert.ok(summary.includes('likes cats'));
				assert.ok(summary.includes('собеседник'));
			});
		});

		it('replaces fact', () => {
			withinChat(() => {
				memory.addFact('global', 'old fact');
				memory.replaceFact('global', 0, 'new fact');
				const summary = memory.getMemorySummary();
				assert.ok(!summary.includes('old fact'));
				assert.ok(summary.includes('new fact'));
			});
		});

		it('deletes fact', () => {
			withinChat(() => {
				memory.addFact('global', 'to delete');
				const removed = memory.deleteFact('global', 0);
				assert.equal(removed, 'to delete');
				const summary = memory.getMemorySummary();
				assert.equal(summary, null);
			});
		});

		it('returns null for empty summary', () => {
			withinChat(() => {
				assert.equal(memory.getMemorySummary(), null);
			});
		});
	});

	describe('chatlog', () => {
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
