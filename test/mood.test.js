const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.GPT_MODEL = 'test';
process.env.GPT_MODEL_MINI = 'test';
process.env.DATA_DIR = '/tmp/test_mood_data';
process.env.BOT_CONFIG = './bots/billy.js';

const { decayValue, clampDelta, parseAskResponse, MOOD_BASELINE } = require('../src/mood');

describe('decayValue', () => {
	it('returns baseline unchanged', () => {
		assert.equal(decayValue(MOOD_BASELINE), MOOD_BASELINE);
	});

	it('decays high value toward baseline', () => {
		const result = decayValue(80);
		assert.ok(result < 80);
		assert.ok(result >= MOOD_BASELINE);
	});

	it('decays low value toward baseline', () => {
		const result = decayValue(10);
		assert.ok(result > 10);
		assert.ok(result <= MOOD_BASELINE);
	});

	it('decays by at most 5', () => {
		assert.equal(decayValue(100), 95);
		assert.equal(decayValue(5), 10);
	});

	it('decays small differences exactly to baseline', () => {
		assert.equal(decayValue(MOOD_BASELINE + 3), MOOD_BASELINE);
		assert.equal(decayValue(MOOD_BASELINE - 2), MOOD_BASELINE);
	});
});

describe('clampDelta', () => {
	it('returns 0 for NaN', () => {
		assert.equal(clampDelta(NaN), 0);
		assert.equal(clampDelta(undefined), 0);
		assert.equal(clampDelta('abc'), 0);
	});

	it('clamps to [-5, 5]', () => {
		assert.equal(clampDelta(10), 5);
		assert.equal(clampDelta(-10), -5);
	});

	it('rounds to integer', () => {
		assert.equal(clampDelta(2.7), 3);
		assert.equal(clampDelta(-1.3), -1);
	});

	it('passes valid values through', () => {
		assert.equal(clampDelta(3), 3);
		assert.equal(clampDelta(-2), -2);
		assert.equal(clampDelta(0), 0);
	});
});

describe('parseAskResponse', () => {
	it('parses valid JSON', () => {
		const raw = JSON.stringify({
			answer: 'hello',
			mood_delta: 2,
			attitude_delta: -1,
			memory_ops: [{ action: 'save', target: 'global', fact: 'test' }],
		});
		const result = parseAskResponse(raw);
		assert.equal(result.answer, 'hello');
		assert.equal(result.mood_delta, 2);
		assert.equal(result.attitude_delta, -1);
		assert.equal(result.memory_ops.length, 1);
	});

	it('falls back to raw text on invalid JSON', () => {
		const result = parseAskResponse('just plain text');
		assert.equal(result.answer, 'just plain text');
		assert.equal(result.mood_delta, 0);
		assert.equal(result.attitude_delta, 0);
		assert.deepEqual(result.memory_ops, []);
	});

	it('uses raw text when answer is missing', () => {
		const raw = JSON.stringify({ mood_delta: 1 });
		const result = parseAskResponse(raw);
		assert.equal(result.answer, raw);
	});

	it('clamps extreme deltas', () => {
		const raw = JSON.stringify({ answer: 'x', mood_delta: 100, attitude_delta: -50 });
		const result = parseAskResponse(raw);
		assert.equal(result.mood_delta, 5);
		assert.equal(result.attitude_delta, -5);
	});

	it('handles missing memory_ops', () => {
		const raw = JSON.stringify({ answer: 'x' });
		const result = parseAskResponse(raw);
		assert.deepEqual(result.memory_ops, []);
	});

	it('handles non-array memory_ops', () => {
		const raw = JSON.stringify({ answer: 'x', memory_ops: 'invalid' });
		const result = parseAskResponse(raw);
		assert.deepEqual(result.memory_ops, []);
	});
});
