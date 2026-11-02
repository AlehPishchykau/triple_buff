const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/test_voiceshare_' + Date.now();
process.env.DATA_DIR = TEST_DIR;
process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');

const chatScope = require('../src/chatScope');
const voiceShare = require('../src/voiceShare');

const CHAT_ID = '-1001234567890';
const withinChat = (fn) => chatScope.run(CHAT_ID, fn);

describe('voiceShare', () => {
	beforeEach(() => fs.mkdirSync(path.join(TEST_DIR, CHAT_ID), { recursive: true }));
	afterEach(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

	it('first claimer owns the message, second does not', () => withinChat(() => {
		assert.equal(voiceShare.claimVoice(1, 'billy'), true);
		assert.equal(voiceShare.claimVoice(1, 'jesus'), false);
		assert.equal(voiceShare.readVoice(1).by, 'billy');
	}));

	it('waiter receives the text once the owner completes', () => withinChat(async () => {
		voiceShare.claimVoice(2, 'billy');
		setTimeout(() => withinChat(() => voiceShare.completeVoice(2, 'привет')), 30);
		const r = await voiceShare.waitForVoice(2, { timeoutMs: 2000, intervalMs: 10 });
		assert.deepEqual(r, { status: 'done', text: 'привет' });
	}));

	it('a failed claim can be taken over by another bot, not by the same one', () => withinChat(() => {
		voiceShare.claimVoice(3, 'billy');
		voiceShare.failVoice(3);
		assert.equal(voiceShare.claimVoice(3, 'billy'), false);
		assert.equal(voiceShare.claimVoice(3, 'jesus'), true);
		assert.equal(voiceShare.readVoice(3).status, 'pending');
	}));

	it('waiter sees failure and times out when nothing happens', () => withinChat(async () => {
		voiceShare.claimVoice(4, 'billy');
		voiceShare.failVoice(4);
		assert.equal((await voiceShare.waitForVoice(4, { timeoutMs: 200, intervalMs: 10 })).status, 'failed');
		assert.equal((await voiceShare.waitForVoice(99, { timeoutMs: 50, intervalMs: 10 })).status, 'timeout');
	}));

	it('a stale pending claim becomes claimable', () => withinChat(() => {
		voiceShare.claimVoice(5, 'billy');
		const file = path.join(TEST_DIR, CHAT_ID, 'voice_claims.json');
		const claims = JSON.parse(fs.readFileSync(file, 'utf8'));
		claims[5].ts = Date.now() - 2 * 60 * 1000;
		fs.writeFileSync(file, JSON.stringify(claims));
		assert.equal(voiceShare.claimVoice(5, 'jesus'), true);
	}));
});
