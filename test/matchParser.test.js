const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseMatchesData, getSummary, getMVP, getAwards } = require('../src/matchParser');

function makeMatch(overrides = {}) {
	return {
		match_id: 1001,
		steamAccountId: 111,
		hero_id: 1,
		kills: 10,
		deaths: 3,
		assists: 5,
		gold_per_min: 500,
		xp_per_min: 600,
		duration: 1800,
		hero_damage: 15000,
		tower_damage: 3000,
		hero_healing: 0,
		last_hits: 150,
		radiant_win: true,
		player_slot: 0,
		...overrides,
	};
}

const PLAYERS_MAP = {
	111: { name: 'Alice', avatar: 'http://a.png' },
	222: { name: 'Bob', avatar: 'http://b.png' },
};

const HEROES = {
	1: { id: 1, displayName: 'Anti-Mage', shortName: 'antimage' },
	2: { id: 2, displayName: 'Axe', shortName: 'axe' },
};

describe('parseMatchesData', () => {
	it('parses single player with one match', () => {
		const data = parseMatchesData([[makeMatch()]]);
		assert.ok(data.players[111]);
		assert.equal(data.players[111].wins, 1);
		assert.equal(data.players[111].loses, 0);
		assert.equal(data.players[111].matches.length, 1);
	});

	it('tracks wins and losses correctly', () => {
		const data = parseMatchesData([[
			makeMatch({ match_id: 1, radiant_win: true, player_slot: 0 }),
			makeMatch({ match_id: 2, radiant_win: false, player_slot: 0 }),
		]]);
		assert.equal(data.players[111].wins, 1);
		assert.equal(data.players[111].loses, 1);
	});

	it('calculates KDA correctly', () => {
		const data = parseMatchesData([[makeMatch({ kills: 10, deaths: 2, assists: 8 })]]);
		assert.equal(data.players[111].kdas[0], (10 + 8) / 2);
	});

	it('handles zero deaths in KDA', () => {
		const data = parseMatchesData([[makeMatch({ kills: 5, deaths: 0, assists: 3 })]]);
		assert.equal(data.players[111].kdas[0], 8);
	});

	it('tracks awards', () => {
		const data = parseMatchesData([[
			makeMatch({ steamAccountId: 111, deaths: 10, gold_per_min: 200, tower_damage: 1000, duration: 1800 }),
			makeMatch({ steamAccountId: 222, deaths: 2, gold_per_min: 700, tower_damage: 5000, duration: 1800, match_id: 1002 }),
		]]);
		assert.equal(data.awards.feeder.steamAccountId, 111);
		assert.equal(data.awards.farmer.steamAccountId, 222);
		assert.equal(data.awards.destroyer.steamAccountId, 222);
	});

	it('tracks match durations', () => {
		const data = parseMatchesData([[
			makeMatch({ duration: 1200, match_id: 1 }),
			makeMatch({ duration: 2400, match_id: 2 }),
		]]);
		assert.equal(data.summary.longestMatchDuration, 2400);
		assert.equal(data.summary.shortestMatchDuration, 1200);
	});

	it('handles multiple players', () => {
		const data = parseMatchesData([
			[makeMatch({ steamAccountId: 111 })],
			[makeMatch({ steamAccountId: 222, match_id: 1002 })],
		]);
		assert.ok(data.players[111]);
		assert.ok(data.players[222]);
	});

	it('handles empty input', () => {
		const data = parseMatchesData([]);
		assert.deepEqual(data.players, {});
		assert.equal(Object.keys(data.summary.wins).length, 0);
	});
});

describe('getSummary', () => {
	it('returns no-match message for empty data', () => {
		const data = parseMatchesData([]);
		const result = getSummary(data, PLAYERS_MAP);
		assert.ok(result.includes('похуй'));
	});

	it('handles single player', () => {
		const data = parseMatchesData([[makeMatch()]]);
		const result = getSummary(data, PLAYERS_MAP);
		assert.ok(result.includes('only strong man'));
		assert.ok(result.includes('Alice'));
	});

	it('handles multiple players', () => {
		const data = parseMatchesData([
			[makeMatch({ steamAccountId: 111 })],
			[makeMatch({ steamAccountId: 222, match_id: 1002 })],
		]);
		const result = getSummary(data, PLAYERS_MAP);
		assert.ok(result.includes('Strong men'));
		assert.ok(result.includes('Alice'));
		assert.ok(result.includes('Bob'));
	});

	it('uses correct period label', () => {
		const data = parseMatchesData([[makeMatch()]]);
		assert.ok(getSummary(data, PLAYERS_MAP, 'week').includes('за неделю'));
		assert.ok(getSummary(data, PLAYERS_MAP, 'today').includes('за сутки'));
	});
});

describe('getMVP', () => {
	it('picks the player with highest score', () => {
		const data = parseMatchesData([
			[makeMatch({ steamAccountId: 111, kills: 2, deaths: 10, assists: 0, gold_per_min: 200, radiant_win: false, player_slot: 0 })],
			[makeMatch({ steamAccountId: 222, kills: 20, deaths: 1, assists: 10, gold_per_min: 800, match_id: 1002 })],
		]);
		const mvp = getMVP(data, PLAYERS_MAP);
		assert.equal(mvp.name, 'Bob');
	});

	it('returns avatar', () => {
		const data = parseMatchesData([[makeMatch()]]);
		const mvp = getMVP(data, PLAYERS_MAP);
		assert.equal(mvp.avatar, 'http://a.png');
	});
});

describe('getAwards', () => {
	it('returns null when no matches', () => {
		const data = parseMatchesData([]);
		assert.equal(getAwards(data, PLAYERS_MAP, HEROES), null);
	});

	it('generates awards HTML', () => {
		const data = parseMatchesData([[makeMatch()]]);
		const awards = getAwards(data, PLAYERS_MAP, HEROES);
		assert.ok(awards.includes('Фидер'));
		assert.ok(awards.includes('Фармер'));
		assert.ok(awards.includes('Разрушитель'));
		assert.ok(awards.includes('Керри'));
		assert.ok(awards.includes('Alice'));
	});

	it('includes hero names', () => {
		const data = parseMatchesData([[makeMatch({ hero_id: 1 })]]);
		const awards = getAwards(data, PLAYERS_MAP, HEROES);
		assert.ok(awards.includes('Anti-Mage'));
	});
});
