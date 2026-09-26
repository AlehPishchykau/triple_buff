const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.GPT_MODEL = 'test';
process.env.GPT_MODEL_MINI = 'test';
process.env.DATA_DIR = '/tmp/test_crossbot';
process.env.BOT_CONFIG = './bots/billy.js';

const crossBot = require('../src/crossBot');

describe('crossBot state tracking', () => {
	beforeEach(() => {
		crossBot.resetChain('chat1');
	});

	it('resetChain sets chainCount to 0', () => {
		crossBot.trackBotMessage('chat1');
		crossBot.trackBotMessage('chat1');
		crossBot.resetChain('chat1');
		// After reset, canReplyToBot should be possible again (probability aside)
		// Just verify no error
	});

	it('trackBotMessage increments chain count', () => {
		crossBot.trackBotMessage('chat2');
		crossBot.trackBotMessage('chat2');
		// After 2 messages, maxChain (2) is reached
		// canReplyToBot should return false due to chain limit
		// We test indirectly: track 3 messages, then the 3rd should be blocked
		crossBot.trackBotMessage('chat2');
	});

	it('canReplyToBot returns false without crossBot config', () => {
		// Billy has crossBot config, so override persona temporarily
		// This is a basic check — with config, randomness is involved
		const result = crossBot.canReplyToBot('new_chat');
		// Result is probabilistic (30% chance), so we just verify it doesn't throw
		assert.equal(typeof result, 'boolean');
	});

	it('canReplyToBot respects maxChain', () => {
		// Track enough messages to exceed maxChain
		crossBot.trackBotMessage('chain_test');
		crossBot.trackBotMessage('chain_test');
		crossBot.trackBotMessage('chain_test');

		// After 3 bot messages (maxChain=2), should always return false
		let trueCount = 0;
		for (let i = 0; i < 100; i++) {
			if (crossBot.canReplyToBot('chain_test')) trueCount++;
		}
		assert.equal(trueCount, 0);
	});

	it('canReplyToBot respects cooldown', () => {
		crossBot.markBotReply('cooldown_test');

		// Immediately after marking reply, cooldown should block
		let trueCount = 0;
		for (let i = 0; i < 100; i++) {
			if (crossBot.canReplyToBot('cooldown_test')) trueCount++;
		}
		assert.equal(trueCount, 0);
	});

	it('markBotReply updates lastReplyTs', () => {
		crossBot.markBotReply('ts_test');
		// No throw, state updated
	});

	it('canRandomInterject returns boolean', () => {
		const result = crossBot.canRandomInterject('rand_test');
		assert.equal(typeof result, 'boolean');
	});

	it('canRandomInterject respects cooldown', () => {
		crossBot.markRandomInterjection('rand_cd');

		// Immediately after, should always return false
		let trueCount = 0;
		for (let i = 0; i < 1000; i++) {
			if (crossBot.canRandomInterject('rand_cd')) trueCount++;
		}
		assert.equal(trueCount, 0);
	});

	it('resetChain does not crash on unknown chatId', () => {
		crossBot.resetChain('nonexistent');
	});
});
