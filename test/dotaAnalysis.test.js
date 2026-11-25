const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
	resolveHero, resolvePlayerId, playerLabel, buildMatchView, buildPlayerMatchRow, summarizeMatches,
	averagesFromTotals, buildHeroPool,
} = require('../src/dotaAnalysis');

const heroes = {
	1: { id: 1, displayName: 'Anti-Mage', shortName: 'antimage', roles: ['Carry', 'Escape'], aliases: ['am'] },
	5: { id: 5, displayName: 'Crystal Maiden', shortName: 'crystal_maiden', roles: ['Support'], aliases: ['cm'] },
	63: { id: 63, displayName: 'Weaver', shortName: 'weaver', roles: ['Carry'], aliases: [] },
	94: { id: 94, displayName: 'Medusa', shortName: 'medusa', roles: ['Carry'], aliases: [] },
};
const items = { 1: 'Blink Dagger', 108: "Aghanim's Scepter", 116: 'Black King Bar', 300: 'Safety Bubble' };
const playersMap = {
	100: { name: 'Олег', nick: 'Oleg Tango' },
	200: { name: 'Александр', nick: 'Саня Механизм' },
	300: { name: 'Александр', nick: 'Саша Дезолятор' },
};

function player(over) {
	return {
		player_slot: 0, hero_id: 1, kills: 0, deaths: 0, assists: 0, level: 20, net_worth: 10000,
		gold_per_min: 800, xp_per_min: 1500, last_hits: 50, hero_damage: 10000, tower_damage: 0,
		hero_healing: 0, item_0: 0, item_1: 0, item_2: 0, item_3: 0, item_4: 0, item_5: 0, ...over,
	};
}

function sampleMatch() {
	return {
		match_id: 9000000001, start_time: 1795556554, duration: 1554, radiant_win: false,
		radiant_score: 10, dire_score: 30, tower_status_radiant: 0b11, tower_status_dire: 0b11111111111,
		players: [
			player({ player_slot: 0, hero_id: 5, kills: 2, deaths: 9, assists: 6, net_worth: 9000, hero_damage: 5000 }),
			player({ player_slot: 1, hero_id: 63, kills: 8, deaths: 5, assists: 2, net_worth: 21000, hero_damage: 15000, personaname: 'rnd' }),
			player({
				player_slot: 128, account_id: 100, hero_id: 94, kills: 12, deaths: 2, assists: 9, net_worth: 30000,
				hero_damage: 30000, tower_damage: 14000, item_0: 116, item_1: 1, aghanims_scepter: 1, aghanims_shard: 1, item_neutral: 300,
				benchmarks: { gold_per_min: { raw: 1491, pct: 0.72 }, hero_damage_per_min: { raw: 900, pct: 0.494 }, hero_healing_per_min: { raw: 0, pct: 0.7 }, tower_damage: { raw: 14000, pct: 0.94 } },
			}),
			player({ player_slot: 129, account_id: 200, hero_id: 5, kills: 3, deaths: 6, assists: 21, net_worth: 10000, hero_damage: 10000, hero_healing: 800 }),
		],
	};
}

describe('dotaAnalysis', () => {
	describe('resolveHero', () => {
		it('matches official name regardless of case and punctuation', () => {
			assert.equal(resolveHero(heroes, 'anti mage').id, 1);
			assert.equal(resolveHero(heroes, 'Crystal Maiden').id, 5);
		});
		it('matches short names, aliases and unique prefixes', () => {
			assert.equal(resolveHero(heroes, 'crystal_maiden').id, 5);
			assert.equal(resolveHero(heroes, 'cm').id, 5);
			assert.equal(resolveHero(heroes, 'weav').id, 63);
		});
		it('returns null for unknown or empty input', () => {
			assert.equal(resolveHero(heroes, 'Techies'), null);
			assert.equal(resolveHero(heroes, ''), null);
		});
	});

	describe('resolvePlayerId', () => {
		const tg = { 100: '@midsummer314', 200: '@sashashukala' };
		it('passes numeric ids through, including untracked ones', () => {
			assert.equal(resolvePlayerId('100', playersMap, tg), '100');
			assert.equal(resolvePlayerId(987654, playersMap, tg), '987654');
		});
		it('resolves telegram tags, nicks and unique names', () => {
			assert.equal(resolvePlayerId('midsummer314', playersMap, tg), '100');
			assert.equal(resolvePlayerId('@sashashukala', playersMap, tg), '200');
			assert.equal(resolvePlayerId('Саша Дезолятор', playersMap, tg), '300');
			assert.equal(resolvePlayerId('олег', playersMap, tg), '100');
		});
		it('refuses ambiguous or unknown references', () => {
			assert.equal(resolvePlayerId('Александр', playersMap, tg), null);
			assert.equal(resolvePlayerId('кто-то', playersMap, tg), null);
			assert.equal(resolvePlayerId('', playersMap, tg), null);
		});
	});

	describe('playerLabel', () => {
		it('uses plain name when unique and adds nick for namesakes', () => {
			assert.equal(playerLabel(playersMap, 100), 'Олег');
			assert.equal(playerLabel(playersMap, 200), 'Александр «Саня Механизм»');
			assert.equal(playerLabel(playersMap, 999), null);
		});
	});

	describe('buildMatchView', () => {
		const view = buildMatchView(sampleMatch(), { heroes, items, playersMap });
		const oleg = view.players.find(p => p.name === 'Олег');

		it('describes the match and our side', () => {
			assert.equal(view.url, 'https://www.opendota.com/matches/9000000001');
			assert.equal(view.winner, 'dire');
			assert.equal(view.our_team, 'dire');
			assert.equal(view.our_result, 'win');
			assert.deepEqual(view.score, { radiant: 10, dire: 30 });
			assert.equal(view.teams.radiant.towers_left, 2);
			assert.equal(view.teams.dire.towers_left, 11);
			assert.deepEqual(view.our_players, ['Олег (Medusa)', 'Александр «Саня Механизм» (Crystal Maiden)']);
		});

		it('computes shares relative to the own team', () => {
			assert.equal(oleg.ours, true);
			assert.equal(oleg.farm_rank, 1);
			assert.equal(oleg.nw_share_pct, 75);
			assert.equal(oleg.dmg_share_pct, 75);
			assert.equal(oleg.kill_participation_pct, 140); // (12+9)/15 team kills in the fixture
			assert.equal(oleg.kda, '12/2/9');
		});

		it('names items, consumed buffs and converts benchmarks to percentiles', () => {
			assert.deepEqual(oleg.items, ['Black King Bar', 'Blink Dagger']);
			assert.deepEqual(oleg.buffs, ["Aghanim's Scepter (consumed)", "Aghanim's Shard"]);
			assert.equal(oleg.neutral, 'Safety Bubble');
			assert.deepEqual(oleg.pct_vs_hero, { gpm: 72, hero_damage: 49, tower_damage: 94 });
		});

		it('keeps non-tracked players anonymous and unmarked', () => {
			const anon = view.players[0];
			assert.equal(anon.name, 'аноним');
			assert.equal(anon.ours, undefined);
			assert.equal(view.players[1].name, 'rnd');
			assert.equal(view.players[3].healing, 800);
		});

		it('reports both sides when tracked players are opponents', () => {
			const m = sampleMatch();
			m.players[0].account_id = 300;
			const v = buildMatchView(m, { heroes, items, playersMap });
			assert.equal(v.our_team, 'both');
			assert.equal(v.our_result, undefined);
		});
	});

	describe('summarizeMatches', () => {
		const rows = [
			{ player_slot: 0, radiant_win: true, kills: 10, deaths: 2, assists: 8, gold_per_min: 1200, hero_damage: 30000, tower_damage: 4000, last_hits: 150, duration: 1500 },
			{ player_slot: 0, radiant_win: true, kills: 6, deaths: 4, assists: 10, gold_per_min: 1000, hero_damage: 20000, tower_damage: 2000, last_hits: 100, duration: 1700 },
			{ player_slot: 130, radiant_win: true, kills: 2, deaths: 9, assists: 3, gold_per_min: 800, hero_damage: 10000, tower_damage: 0, last_hits: 50, duration: 1300 },
		];
		it('aggregates record, averages and streak', () => {
			const s = summarizeMatches(rows);
			assert.equal(s.games, 3);
			assert.equal(s.wins, 2);
			assert.equal(s.winrate_pct, 67);
			assert.equal(s.current_streak, '2 побед подряд');
			assert.equal(s.avg_kills, 6);
			assert.equal(s.avg_gpm, 1000);
			assert.equal(s.kda_ratio, 2.6);
			assert.equal(s.avg_duration_min, 25);
		});
		it('handles an empty list', () => {
			assert.deepEqual(summarizeMatches([]), { games: 0 });
		});
	});

	it('buildPlayerMatchRow keeps id, link, hero and result', () => {
		const row = buildPlayerMatchRow({ match_id: 5, player_slot: 128, radiant_win: false, hero_id: 63, start_time: 1795556554, duration: 1800, kills: 9, deaths: 9, assists: 21, gold_per_min: 1570, xp_per_min: 2846, hero_damage: 1, tower_damage: 2, hero_healing: 0, last_hits: 3 }, heroes);
		assert.equal(row.url, 'https://www.opendota.com/matches/5');
		assert.equal(row.hero, 'Weaver');
		assert.equal(row.result, 'win');
		assert.equal(row.kda, '9/9/21');
		assert.equal(row.healing, undefined);
	});

	it('averagesFromTotals divides sums and ignores irrelevant fields', () => {
		const a = averagesFromTotals([{ field: 'kills', n: 10, sum: 75 }, { field: 'gold_per_min', n: 10, sum: 10830 }, { field: 'pings', n: 10, sum: 99 }]);
		assert.deepEqual(a, { games: 10, avg_kills: 7.5, avg_gold_per_min: 1083 });
	});

	it('buildHeroPool ranks by games and applies a minimum sample to winrate lists', () => {
		const pool = buildHeroPool([
			{ heroId: 1, matchCount: 100, winCount: 40 },
			{ heroId: 5, matchCount: 20, winCount: 15 },
			{ heroId: 63, matchCount: 3, winCount: 3 },
		], heroes, { top: 2, edge: 1 });
		assert.equal(pool.heroes_played, 3);
		assert.deepEqual(pool.most_played.map(h => h.hero), ['Anti-Mage', 'Crystal Maiden']);
		assert.equal(pool.best_winrate[0].hero, 'Crystal Maiden');
		assert.equal(pool.worst_winrate[0].hero, 'Anti-Mage');
	});
});
