const { OPENDOTA_API_URL } = require('./constants');

async function openDotaGet(path, retries = 2) {
	const response = await fetch(`${OPENDOTA_API_URL}${path}`);

	if (response.status === 429 && retries > 0) {
		const delay = parseInt(response.headers.get('retry-after') || '5', 10) * 1000;
		await new Promise(r => setTimeout(r, delay));
		return openDotaGet(path, retries - 1);
	}

	if (!response.ok) {
		throw new Error(`OpenDota: ${response.status} ${response.statusText}`);
	}

	return response.json();
}

async function openDotaPost(path) {
	await fetch(`${OPENDOTA_API_URL}${path}`, { method: 'POST' }).catch(() => {});
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

module.exports = {
	openDotaGet,
	openDotaPost,
	isTurbo,
	isWin,
	secondsToTime,
	convertMiliseconds
};
