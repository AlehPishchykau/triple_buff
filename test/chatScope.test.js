const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/test_chatscope_' + Date.now();

process.env.DATA_DIR = TEST_DIR;

const chatScope = require('../src/chatScope');

describe('chatScope', () => {
	beforeEach(() => {
		fs.mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it('runs function within chat context', () => {
		chatScope.run('123', () => {
			assert.equal(chatScope.getChatId(), '123');
		});
	});

	it('returns undefined outside context', () => {
		assert.equal(chatScope.getChatId(), undefined);
	});

	it('returns correct chatDir', () => {
		chatScope.run('456', () => {
			const dir = chatScope.chatDir();
			assert.ok(dir.endsWith('456'));
		});
	});

	it('accepts explicit chatId for chatDir', () => {
		const dir = chatScope.chatDir('789');
		assert.ok(dir.endsWith('789'));
	});

	it('throws without context or explicit id', () => {
		assert.throws(() => chatScope.chatDir(), /No chat context/);
	});

	it('returns personaDir under chatDir', () => {
		chatScope.run('100', () => {
			const dir = chatScope.personaDir('billy');
			assert.ok(dir.includes('100'));
			assert.ok(dir.endsWith('billy'));
		});
	});

	it('lists chat IDs from directories', () => {
		fs.mkdirSync(path.join(TEST_DIR, '-1001234'), { recursive: true });
		fs.mkdirSync(path.join(TEST_DIR, '5678'), { recursive: true });
		fs.mkdirSync(path.join(TEST_DIR, 'not_a_chat'), { recursive: true });

		const ids = chatScope.listChatIds();
		assert.ok(ids.includes('-1001234'));
		assert.ok(ids.includes('5678'));
		assert.ok(!ids.includes('not_a_chat'));
	});

	it('returns empty array when data dir missing', () => {
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
		const ids = chatScope.listChatIds();
		assert.deepEqual(ids, []);
	});

	it('isolates contexts', async () => {
		const results = [];
		await Promise.all([
			chatScope.run('aaa', () => {
				results.push(chatScope.getChatId());
			}),
			chatScope.run('bbb', () => {
				results.push(chatScope.getChatId());
			}),
		]);
		assert.ok(results.includes('aaa'));
		assert.ok(results.includes('bbb'));
	});
});
