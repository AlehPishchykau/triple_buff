const OPENDOTA_API_URL = 'https://api.opendota.com/api';

// OpenDota allows 60 requests a minute per IP, shared by every bot on the box. A deep
// question can hit the same endpoint several times, so identical GETs are served from a
// short-lived cache; finished matches and constants never change and live longer.
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_TTL_STATIC_MS = 30 * 60 * 1000;
const CACHE_MAX = 300;
const getCache = new Map();

function cacheTtl(path) {
	return /^\/(matches|constants)\//.test(path) ? CACHE_TTL_STATIC_MS : CACHE_TTL_MS;
}

function openDotaGet(path) {
	const hit = getCache.get(path);
	if (hit && hit.expires > Date.now()) return hit.promise;

	const promise = openDotaFetch(path);
	getCache.set(path, { promise, expires: Date.now() + cacheTtl(path) });
	// Drop a failed request, but only if a newer one has not replaced it in the meantime.
	promise.catch(() => { if (getCache.get(path)?.promise === promise) getCache.delete(path); });
	if (getCache.size > CACHE_MAX) getCache.delete(getCache.keys().next().value);
	return promise;
}

function clearOpenDotaCache() {
	getCache.clear();
}

async function openDotaFetch(path, retries = 2) {
	const response = await fetch(`${OPENDOTA_API_URL}${path}`);

	if (response.status === 429 && retries > 0) {
		const delay = parseInt(response.headers.get('retry-after') || '5', 10) * 1000;
		await new Promise(r => setTimeout(r, delay));
		return openDotaFetch(path, retries - 1);
	}

	if (!response.ok) {
		throw new Error(`OpenDota: ${response.status} ${response.statusText}`);
	}

	return response.json();
}

async function openDotaPost(path) {
	await fetch(`${OPENDOTA_API_URL}${path}`, { method: 'POST' }).catch(() => {});
	clearOpenDotaCache();
}

function isTurbo(match) {
	return match.game_mode === 23 || (match.game_mode === 22 && match.lobby_type === 7);
}

function isWin(match) {
	return match.radiant_win === (match.player_slot < 128);
}

function secondsToTime(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function convertMiliseconds(miliseconds, format) {
	let total_seconds = parseInt(Math.floor(miliseconds / 1000));
	let total_minutes = parseInt(Math.floor(total_seconds / 60));
	let total_hours = parseInt(Math.floor(total_minutes / 60));
	let days = parseInt(Math.floor(total_hours / 24));

	let seconds = parseInt(total_seconds % 60);
	let minutes = parseInt(total_minutes % 60);
	let hours = parseInt(total_hours % 24);

	switch(format) {
	  case 's':
		  return total_seconds;
	  case 'm':
		  return total_minutes;
	  case 'h':
		  return total_hours;
	  case 'd':
		  return days;
	  default:
		  return `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`
	}
}

function escapeHTML(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TELEGRAM_ALLOWED_TAGS = new Set([
	'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
	'code', 'pre', 'a', 'blockquote', 'tg-spoiler', 'tg-emoji',
]);

function sanitizeTelegramHTML(text) {
	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(/<hr\s*\/?>/gi, '\n');
	return text.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)>/g, (match, slash, tagName) => {
		if (TELEGRAM_ALLOWED_TAGS.has(tagName.toLowerCase())) return match;
		return '';
	});
}

module.exports = {
	openDotaGet,
	clearOpenDotaCache,
	openDotaPost,
	isTurbo,
	isWin,
	secondsToTime,
	convertMiliseconds,
	escapeHTML,
	sanitizeTelegramHTML,
};
