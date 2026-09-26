const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isTurbo, isWin, secondsToTime, convertMiliseconds, escapeHTML, sanitizeTelegramHTML } = require('../src/utils');

describe('isTurbo', () => {
	it('returns true for game_mode 23', () => {
		assert.equal(isTurbo({ game_mode: 23 }), true);
	});

	it('returns true for game_mode 22 with lobby_type 7', () => {
		assert.equal(isTurbo({ game_mode: 22, lobby_type: 7 }), true);
	});

	it('returns false for game_mode 22 without lobby_type 7', () => {
		assert.equal(isTurbo({ game_mode: 22, lobby_type: 0 }), false);
	});

	it('returns false for regular match', () => {
		assert.equal(isTurbo({ game_mode: 1, lobby_type: 0 }), false);
	});
});

describe('isWin', () => {
	it('returns true for radiant win with radiant player', () => {
		assert.equal(isWin({ radiant_win: true, player_slot: 0 }), true);
	});

	it('returns false for radiant win with dire player', () => {
		assert.equal(isWin({ radiant_win: true, player_slot: 128 }), false);
	});

	it('returns true for dire win with dire player', () => {
		assert.equal(isWin({ radiant_win: false, player_slot: 200 }), true);
	});

	it('returns false for dire win with radiant player', () => {
		assert.equal(isWin({ radiant_win: false, player_slot: 4 }), false);
	});

	it('handles player_slot boundary (127 = radiant)', () => {
		assert.equal(isWin({ radiant_win: true, player_slot: 127 }), true);
	});

	it('handles player_slot boundary (128 = dire)', () => {
		assert.equal(isWin({ radiant_win: true, player_slot: 128 }), false);
	});
});

describe('secondsToTime', () => {
	it('formats zero seconds', () => {
		assert.equal(secondsToTime(0), '00:00');
	});

	it('formats minutes and seconds', () => {
		assert.equal(secondsToTime(90), '01:30');
	});

	it('formats large durations', () => {
		assert.equal(secondsToTime(3661), '61:01');
	});
});

describe('convertMiliseconds', () => {
	it('formats days, hours, minutes', () => {
		const ms = (2 * 86400 + 3 * 3600 + 15 * 60) * 1000;
		const result = convertMiliseconds(ms);
		assert.ok(result.includes('2d'));
		assert.ok(result.includes('3h'));
		assert.ok(result.includes('15m'));
	});

	it('returns total seconds with format s', () => {
		assert.equal(convertMiliseconds(5000, 's'), 5);
	});

	it('returns total minutes with format m', () => {
		assert.equal(convertMiliseconds(120000, 'm'), 2);
	});

	it('returns total hours with format h', () => {
		assert.equal(convertMiliseconds(7200000, 'h'), 2);
	});

	it('returns total days with format d', () => {
		assert.equal(convertMiliseconds(172800000, 'd'), 2);
	});

	it('omits zero days', () => {
		const result = convertMiliseconds(3600000);
		assert.ok(!result.includes('d'));
	});
});

describe('escapeHTML', () => {
	it('escapes ampersand', () => {
		assert.equal(escapeHTML('a & b'), 'a &amp; b');
	});

	it('escapes angle brackets', () => {
		assert.equal(escapeHTML('<script>'), '&lt;script&gt;');
	});

	it('handles mixed content', () => {
		assert.equal(escapeHTML('1 < 2 & 3 > 1'), '1 &lt; 2 &amp; 3 &gt; 1');
	});
});

describe('sanitizeTelegramHTML', () => {
	it('keeps allowed tags', () => {
		assert.equal(sanitizeTelegramHTML('<b>bold</b>'), '<b>bold</b>');
		assert.equal(sanitizeTelegramHTML('<i>italic</i>'), '<i>italic</i>');
		assert.equal(sanitizeTelegramHTML('<code>code</code>'), '<code>code</code>');
	});

	it('strips disallowed tags', () => {
		assert.equal(sanitizeTelegramHTML('<div>text</div>'), 'text');
		assert.equal(sanitizeTelegramHTML('<span>text</span>'), 'text');
	});

	it('converts br to newline', () => {
		assert.equal(sanitizeTelegramHTML('a<br>b'), 'a\nb');
		assert.equal(sanitizeTelegramHTML('a<br/>b'), 'a\nb');
	});

	it('converts hr to newline', () => {
		assert.equal(sanitizeTelegramHTML('a<hr>b'), 'a\nb');
	});

	it('handles nested allowed tags', () => {
		assert.equal(sanitizeTelegramHTML('<b><i>bold italic</i></b>'), '<b><i>bold italic</i></b>');
	});
});
