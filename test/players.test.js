const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/test_players_' + Date.now();

process.env.DATA_DIR = TEST_DIR;

const chatScope = require('../src/chatScope');
const players = require('../src/players');

const CHAT_ID = '-100999';

function withinChat(fn) {
	return chatScope.run(CHAT_ID, fn);
}

describe('players', () => {
	beforeEach(() => {
		fs.mkdirSync(path.join(TEST_DIR, CHAT_ID), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it('returns empty for new chat', () => {
		withinChat(() => {
			assert.deepEqual(players.getIds(), []);
			assert.deepEqual(players.getTelegramUsernames(), []);
		});
	});

	it('registers a player', () => {
		withinChat(() => {
			players.register('12345', 999, '@alice', 'Алиса');
			const ids = players.getIds();
			assert.equal(ids.length, 1);
			assert.equal(ids[0], 12345);
		});
	});

	it('stores name', () => {
		withinChat(() => {
			players.register('12345', 999, '@alice', 'Алиса');
			const data = players.load();
			assert.equal(data['12345'].name, 'Алиса');
		});
	});

	it('returns telegram usernames', () => {
		withinChat(() => {
			players.register('111', 1, '@alice', 'Алиса');
			players.register('222', 2, '@bob', 'Боб');
			const usernames = players.getTelegramUsernames();
			assert.deepEqual(usernames.sort(), ['@alice', '@bob']);
		});
	});

	it('builds telegram map', () => {
		withinChat(() => {
			players.register('111', 1, '@alice', 'Алиса');
			const map = players.getTelegramMap();
			assert.equal(map[111], '@alice');
		});
	});

	it('unregisters a player', () => {
		withinChat(() => {
			players.register('111', 42, '@alice', 'Алиса');
			const dotaId = players.unregister(42);
			assert.equal(dotaId, '111');
			assert.deepEqual(players.getIds(), []);
		});
	});

	it('returns null for unregistering unknown player', () => {
		withinChat(() => {
			const result = players.unregister(999);
			assert.equal(result, null);
		});
	});

	it('handles multiple players', () => {
		withinChat(() => {
			players.register('111', 1, '@alice', 'Алиса');
			players.register('222', 2, '@bob', 'Боб');
			players.register('333', 3, null, 'Чарли');
			assert.equal(players.getIds().length, 3);
			assert.equal(players.getTelegramUsernames().length, 2);
		});
	});
});
