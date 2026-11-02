const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TEST_DIR = '/tmp/test_filegate_' + Date.now();
process.env.DATA_DIR = TEST_DIR;
process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');

const { createFileGate } = require('../src/fileGate');

describe('fileGate', () => {
	let stateFile;
	beforeEach(() => { fs.mkdirSync(TEST_DIR, { recursive: true }); stateFile = path.join(TEST_DIR, 'gate.json'); });
	afterEach(() => fs.rmSync(TEST_DIR, { recursive: true, force: true }));

	it('is available by default and pauses after the first failure', () => {
		const g = createFileGate({ stateFile, pauseBaseMs: 60000 });
		assert.equal(g.available(), true);
		g.recordResult(false);
		assert.equal(g.available(), false);
		assert.ok(g.pausedForMs() > 50000);
	});

	it('persists the pause across instances (process restarts)', () => {
		createFileGate({ stateFile, pauseBaseMs: 60000 }).recordResult(false);
		assert.equal(createFileGate({ stateFile }).available(), false);
	});

	it('doubles the pause on repeated trips up to the max, resets on success', () => {
		const g = createFileGate({ stateFile, pauseBaseMs: 1000, pauseMaxMs: 3000 });
		g.recordResult(false); assert.ok(Math.abs(g.pausedForMs() - 1000) < 100);
		g.recordResult(false); assert.ok(Math.abs(g.pausedForMs() - 2000) < 100);
		g.recordResult(false); assert.ok(Math.abs(g.pausedForMs() - 3000) < 100);
		g.recordResult(true);
		assert.equal(g.available(), true);
		g.recordResult(false); assert.ok(Math.abs(g.pausedForMs() - 1000) < 100);
	});

	it('serializes callers with a minimum gap', async () => {
		const g = createFileGate({ stateFile, minGapMs: 50 });
		const t0 = Date.now();
		const times = [];
		await Promise.all([1, 2, 3].map(() => g.acquire().then(() => times.push(Date.now() - t0))));
		assert.equal(times.length, 3);
		assert.ok(times[2] >= 90, `third call too early: ${times[2]}ms`);
	});
});
