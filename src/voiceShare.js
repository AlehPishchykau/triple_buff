const path = require('path');
const fs = require('fs');
const chatScope = require('./chatScope');
const { withFileLock } = require('./memory');

// Several personas usually sit in the same chat and used to download + transcribe
// every voice message independently (N× getFile, N× whisper). Telegram throttles
// getFile per bot under that load. Now the first bot to claim a message transcribes
// it and publishes the text here; the others wait for it instead of downloading.

const CLAIM_TTL_MS = 60 * 60 * 1000;
const PENDING_STALE_MS = 60 * 1000;
const WAIT_TIMEOUT_MS = 45 * 1000;
const WAIT_INTERVAL_MS = 1000;

function claimsPath() {
	return path.join(chatScope.chatDir(), 'voice_claims.json');
}

function readClaims(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return {};
	}
}

function writeClaims(file, claims) {
	const cutoff = Date.now() - CLAIM_TTL_MS;
	const fresh = Object.fromEntries(Object.entries(claims).filter(([, c]) => c.ts > cutoff));
	fs.writeFileSync(file, JSON.stringify(fresh));
}

function isClaimable(entry, now) {
	if (!entry) return true;
	if (entry.status === 'failed') return true;
	if (entry.status === 'pending' && now - entry.ts > PENDING_STALE_MS) return true;
	return false;
}

// Returns true if this bot now owns the transcription of msgId.
function claimVoice(msgId, botName) {
	const file = claimsPath();
	return withFileLock(file, () => {
		const claims = readClaims(file);
		const now = Date.now();
		const entry = claims[msgId];
		if (!isClaimable(entry, now)) return false;
		if (entry?.status === 'failed' && entry.by === botName) return false;
		claims[msgId] = { by: botName, status: 'pending', ts: now };
		writeClaims(file, claims);
		return true;
	});
}

function updateClaim(msgId, patch) {
	const file = claimsPath();
	withFileLock(file, () => {
		const claims = readClaims(file);
		claims[msgId] = { ...(claims[msgId] || {}), ...patch, ts: Date.now() };
		writeClaims(file, claims);
	});
}

function completeVoice(msgId, text) {
	updateClaim(msgId, { status: 'done', text: text || '' });
}

function failVoice(msgId) {
	updateClaim(msgId, { status: 'failed' });
}

function readVoice(msgId) {
	return readClaims(claimsPath())[msgId] || null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Resolves to { status: 'done', text } | { status: 'failed' } | { status: 'timeout' }.
async function waitForVoice(msgId, { timeoutMs = WAIT_TIMEOUT_MS, intervalMs = WAIT_INTERVAL_MS } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const entry = readVoice(msgId);
		if (entry?.status === 'done') return { status: 'done', text: entry.text };
		if (entry?.status === 'failed') return { status: 'failed' };
		if (entry?.status === 'pending' && Date.now() - entry.ts > PENDING_STALE_MS) return { status: 'failed' };
		if (Date.now() >= deadline) return { status: 'timeout' };
		await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
	}
}

module.exports = { claimVoice, completeVoice, failVoice, readVoice, waitForVoice, WAIT_TIMEOUT_MS };
