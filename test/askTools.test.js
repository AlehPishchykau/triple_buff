const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const TEST_DIR = '/tmp/test_asktools_' + Date.now();
process.env.DATA_DIR = TEST_DIR;
process.env.BOT_CONFIG = path.join(__dirname, '..', 'bots', 'billy.js');

const chatScope = require('../src/chatScope');
const { clearOpenDotaCache } = require('../src/utils');
const { ASK_TOOL_HANDLERS } = require('../src/askTools');

const CHAT = '-100777';
const heroes = { 63: { id: 63, displayName: 'Weaver', shortName: 'weaver', roles: [], aliases: [] } };
const playersMap = { 100: { name: 'Олег', nick: 'o' }, 200: { name: 'Вова', nick: 'v' } };
const now = Math.floor(Date.now() / 1000);
const row = (id, ago, win = true) => ({
	match_id: id, player_slot: 0, radiant_win: win, hero_id: 63, start_time: now - ago, duration: 1500,
	kills: 5, deaths: 5, assists: 5, gold_per_min: 1000, xp_per_min: 2000, hero_damage: 20000, tower_damage: 1000, hero_healing: 0, last_hits: 100,
});

describe('ask tool handlers', () => {
	const realFetch = global.fetch;
	let routes;

	beforeEach(() => {
		fs.mkdirSync(path.join(TEST_DIR, CHAT), { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, CHAT, 'players.json'), JSON.stringify({ 100: { telegram: '@oleg', name: 'Олег' }, 200: { telegram: '@vova', name: 'Вова' } }));
		clearOpenDotaCache();
		routes = [];
		global.fetch = async (url) => {
			const route = routes.find(([re]) => re.test(url));
			if (!route) throw new Error(`unexpected request ${url}`);
			const body = route[1](url);
			if (body === 'FAIL') return { ok: false, status: 500, statusText: 'Server Error', headers: { get: () => null } };
			return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
		};
	});
	afterEach(() => { global.fetch = realFetch; fs.rmSync(TEST_DIR, { recursive: true, force: true }); });

	const run = (name, args) => chatScope.run(CHAT, () => ASK_TOOL_HANDLERS[name](args, heroes, playersMap));

	it('get_player_matches summarises the whole period while showing only `count` rows', async () => {
		const games = Array.from({ length: 14 }, (_, i) => row(i + 1, 3600 * (i + 1), i % 2 === 0));
		let requested;
		routes.push([/players\/100\/matches/, (url) => { requested = url; return games; }]);
		const r = await run('get_player_matches', { player_id: 'Олег', days: 7, count: 3 });
		assert.ok(/limit=500/.test(requested) && /date=7/.test(requested));
		assert.equal(r.match_count, 14);
		assert.equal(r.summary.games, 14);
		assert.equal(r.matches.length, 3);
		assert.equal(r.summary_covers, 'все 14 игр за период');
	});

	it('get_player_matches with date keeps only that calendar day', async () => {
		const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' });
		routes.push([/players\/100\/matches/, () => [row(1, 60), row(2, 5 * 86400)]]);
		const r = await run('get_player_matches', { player_id: '100', date: today });
		assert.equal(r.match_count, 1);
		assert.equal(r.matches[0].match_id, 1);
		assert.equal(r.date, today);
	});

	it('compare_players marks a failed player as unavailable instead of "did not play"', async () => {
		routes.push([/players\/100\/matches/, () => [row(1, 60)]]);
		routes.push([/players\/200\/matches/, () => 'FAIL']);
		routes.push([/players\/\d+\/wl/, () => ({ win: 10, lose: 10 })]);
		const r = await run('compare_players', { days: 30 });
		const vova = r.players.find(p => p.player === 'Вова');
		assert.equal(vova.error, 'OpenDota не отдал данные');
		assert.equal(vova.note, undefined);
		assert.ok(r.incomplete.includes('Вова'));
		assert.equal(r.players.find(p => p.player === 'Олег').games, 1);
	});

	it('get_group_matches reports partial data and does not call it "no matches"', async () => {
		routes.push([/players\/100\/matches/, () => 'FAIL']);
		routes.push([/players\/200\/matches/, () => 'FAIL']);
		const r = await run('get_group_matches', { days: 1 });
		assert.equal(r.error, 'OpenDota не отдал данные');
		assert.equal(r.match_count, undefined);
	});

	it('get_player_profile returns the sections that loaded', async () => {
		routes.push([/players\/100\/wl/, () => ({ win: 6, lose: 4 })]);
		routes.push([/players\/100\/totals/, () => 'FAIL']);
		routes.push([/players\/100\/heroes/, () => 'FAIL']);
		routes.push([/players\/100\/matches/, () => [row(1, 60)]]);
		const r = await run('get_player_profile', { player_id: '100' });
		assert.equal(r.winrate.all_time.winrate_pct, 60);
		assert.equal(r.last_20_games.games, 1);
		assert.equal(r.hero_pool, undefined);
		assert.ok(r.unavailable.includes('hero_pool'));
	});

	it('rejects an unknown player reference with a hint', async () => {
		const r = await run('get_player_profile', { player_id: 'кто-то' });
		assert.ok(r.error.includes('не найден'));
	});
});
