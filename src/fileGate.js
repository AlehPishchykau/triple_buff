const fs = require('fs');
const path = require('path');
const chatScope = require('./chatScope');
const persona = require('./persona');

// Governor for Telegram getFile. Telegram rate-limits file downloads per bot and,
// instead of failing fast, lets getFile hang (up to 120s → 504). Observed on
// triple_buff_bot: latency climbs 1s → 7 → 14 → 28s → hangs, and each extra request
// prolongs the limit; ~15 min of silence clears it. So:
//   - one download at a time with a minimum gap between calls,
//   - a single short attempt (healthy getFile takes 0.1–1s),
//   - after the first hang stop for 15 min, then 30, 60 (persisted across restarts).
const DEFAULTS = {
	minGapMs: 3000,
	pauseBaseMs: 15 * 60 * 1000,
	pauseMaxMs: 60 * 60 * 1000,
	resetAfterMs: 2 * 60 * 60 * 1000,
};

function createFileGate(opts = {}) {
	const o = { ...DEFAULTS, ...opts };
	const stateFile = o.stateFile || path.join(chatScope.BASE_DIR, 'file_gate', `${persona.command}.json`);

	function readState() {
		try {
			return { pausedUntil: 0, trips: 0, lastTrip: 0, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) };
		} catch {
			return { pausedUntil: 0, trips: 0, lastTrip: 0 };
		}
	}

	function writeState(s) {
		fs.mkdirSync(path.dirname(stateFile), { recursive: true });
		fs.writeFileSync(stateFile, JSON.stringify(s));
	}

	let chain = Promise.resolve();
	let lastCallAt = 0;

	function available() {
		return Date.now() >= readState().pausedUntil;
	}

	function pausedForMs() {
		return Math.max(0, readState().pausedUntil - Date.now());
	}

	// Serializes callers and enforces the gap. Resolves when the caller may call getFile.
	function acquire() {
		const ticket = chain.then(async () => {
			const wait = lastCallAt + o.minGapMs - Date.now();
			if (wait > 0) await new Promise(r => setTimeout(r, wait));
			lastCallAt = Date.now();
		});
		chain = ticket.catch(() => {});
		return ticket;
	}

	function recordResult(ok) {
		const s = readState();
		if (ok) {
			if (s.trips) {
				console.log('[file-gate] getFile healthy again');
				writeState({ pausedUntil: 0, trips: 0, lastTrip: 0 });
			}
			return;
		}
		const trips = Date.now() - s.lastTrip > o.resetAfterMs ? 0 : s.trips;
		const pause = Math.min(o.pauseBaseMs * 2 ** trips, o.pauseMaxMs);
		writeState({ pausedUntil: Date.now() + pause, trips: trips + 1, lastTrip: Date.now() });
		console.error(`[file-gate] getFile hung — pausing file downloads for ${Math.round(pause / 60000)} min`);
	}

	return { available, pausedForMs, acquire, recordResult, stateFile };
}

module.exports = { createFileGate, DEFAULTS };
