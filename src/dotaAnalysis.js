// Pure helpers that turn raw OpenDota payloads into compact, analysis-ready views
// for the LLM: relative metrics (team shares, percentiles vs same hero), items by
// name, tracked-player marks. No I/O here — see askTools.js for the fetching side.

const TZ = 'Europe/Vilnius';

function matchUrl(matchId) {
	return `https://www.opendota.com/matches/${matchId}`;
}

function formatDate(unixSeconds) {
	return new Date(unixSeconds * 1000).toLocaleString('ru-RU', {
		day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
	});
}

// Calendar day (YYYY-MM-DD) of a timestamp in the chat's timezone.
function localDay(unixSeconds) {
	return new Date(unixSeconds * 1000).toLocaleDateString('sv-SE', { timeZone: TZ });
}

const GAME_MODES = { 1: 'all pick', 2: 'captains mode', 3: 'random draft', 4: 'single draft', 5: 'all random', 18: 'ability draft', 22: 'all pick (ranked/unranked)', 23: 'turbo' };

function gameModeName(mode) {
	return GAME_MODES[mode] || `game_mode ${mode}`;
}

function normalize(text) {
	return String(text || '').toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');
}

// Accepts an official English hero name, internal short name or alias; returns the hero or null.
function resolveHero(heroes, query) {
	const q = normalize(query);
	if (!q) return null;
	const list = Object.values(heroes);
	const names = h => [h.displayName, h.shortName, ...(h.aliases || [])].map(normalize).filter(Boolean);
	const exact = list.find(h => names(h).includes(q));
	if (exact) return exact;
	const partial = list.filter(h => names(h).some(n => n.startsWith(q) || q.startsWith(n)));
	return partial.length === 1 ? partial[0] : null;
}

// Display name of a tracked player; adds the Steam nick when two tracked players share a name.
function playerLabel(playersMap, id) {
	const entry = playersMap[String(id)];
	if (!entry) return null;
	const sameName = Object.values(playersMap).filter(p => p.name === entry.name).length > 1;
	return sameName && entry.nick && entry.nick !== entry.name ? `${entry.name} «${entry.nick}»` : entry.name;
}

// The model sometimes passes a name, nick or telegram tag instead of the numeric id.
function resolvePlayerId(ref, playersMap, telegramMap = {}) {
	const raw = String(ref ?? '').trim();
	if (/^\d+$/.test(raw)) return raw;
	const q = normalize(raw);
	if (!q) return null;
	const matches = Object.entries(playersMap).filter(([id, p]) =>
		[p.name, p.nick, telegramMap[Number(id)]].some(v => normalize(v) === q));
	return matches.length === 1 ? matches[0][0] : null;
}

function isRadiant(p) {
	return p.player_slot < 128;
}

function share(part, total) {
	return total > 0 ? Math.round((part / total) * 100) : 0;
}

function countBits(n) {
	let count = 0;
	for (let v = n || 0; v; v >>= 1) count += v & 1;
	return count;
}

const BENCHMARK_FIELDS = {
	gold_per_min: 'gpm',
	xp_per_min: 'xpm',
	kills_per_min: 'kills',
	last_hits_per_min: 'last_hits',
	hero_damage_per_min: 'hero_damage',
	hero_healing_per_min: 'healing',
	tower_damage: 'tower_damage',
};

function percentiles(benchmarks) {
	if (!benchmarks) return undefined;
	const out = {};
	for (const [field, label] of Object.entries(BENCHMARK_FIELDS)) {
		const b = benchmarks[field];
		if (b && typeof b.pct === 'number' && (b.raw > 0 || label !== 'healing')) out[label] = Math.round(b.pct * 100);
	}
	return Object.keys(out).length ? out : undefined;
}

function itemNames(p, items) {
	const names = [];
	for (let i = 0; i < 6; i++) {
		const name = items[p[`item_${i}`]];
		if (name) names.push(name);
	}
	const buffs = [];
	if (p.aghanims_scepter && !names.includes("Aghanim's Scepter")) buffs.push("Aghanim's Scepter (consumed)");
	if (p.aghanims_shard) buffs.push("Aghanim's Shard");
	if (p.moonshard) buffs.push('Moon Shard (consumed)');
	return { items: names, buffs, neutral: items[p.item_neutral] || undefined };
}

function teamTotals(teamPlayers) {
	const sum = f => teamPlayers.reduce((acc, p) => acc + (p[f] || 0), 0);
	return {
		kills: sum('kills'),
		net_worth: teamPlayers.reduce((acc, p) => acc + netWorth(p), 0),
		hero_damage: sum('hero_damage'),
		tower_damage: sum('tower_damage'),
	};
}

function netWorth(p) {
	return p.net_worth || p.total_gold || 0;
}

// Full match → compact view with everything needed to judge each player's impact.
function buildMatchView(match, { heroes = {}, items = {}, playersMap = {} } = {}) {
	const trackedIds = new Set(Object.keys(playersMap).map(Number));
	const sides = { radiant: match.players.filter(isRadiant), dire: match.players.filter(p => !isRadiant(p)) };
	const totals = { radiant: teamTotals(sides.radiant), dire: teamTotals(sides.dire) };
	const farmRank = new Map();
	for (const team of Object.values(sides)) {
		[...team].sort((a, b) => netWorth(b) - netWorth(a)).forEach((p, i) => farmRank.set(p, i + 1));
	}

	const players = match.players.map(p => {
		const side = isRadiant(p) ? 'radiant' : 'dire';
		const team = totals[side];
		const tracked = trackedIds.has(p.account_id);
		const hero = heroes[p.hero_id];
		const nw = netWorth(p);
		return {
			name: tracked ? playerLabel(playersMap, p.account_id) : (p.personaname || 'аноним'),
			...(tracked ? { ours: true } : {}),
			team: side,
			hero: hero?.displayName || String(p.hero_id),
			...(hero?.roles?.length ? { hero_roles: hero.roles.slice(0, 3).join('/') } : {}),
			farm_rank: farmRank.get(p),
			level: p.level,
			kda: `${p.kills}/${p.deaths}/${p.assists}`,
			kill_participation_pct: share(p.kills + p.assists, team.kills),
			net_worth: nw,
			nw_share_pct: share(nw, team.net_worth),
			gpm: p.gold_per_min,
			xpm: p.xp_per_min,
			last_hits: p.last_hits,
			hero_damage: p.hero_damage,
			dmg_share_pct: share(p.hero_damage, team.hero_damage),
			tower_damage: p.tower_damage,
			...(p.hero_healing > 0 ? { healing: p.hero_healing } : {}),
			...itemNames(p, items),
			...(percentiles(p.benchmarks) ? { pct_vs_hero: percentiles(p.benchmarks) } : {}),
			...(p.leaver_status > 1 ? { abandoned: true } : {}),
		};
	});

	const winner = match.radiant_win ? 'radiant' : 'dire';
	const ours = players.filter(p => p.ours);
	const ourTeams = [...new Set(ours.map(p => p.team))];
	return {
		match_id: match.match_id,
		url: matchUrl(match.match_id),
		date: formatDate(match.start_time),
		duration_min: Math.round(match.duration / 60),
		mode: gameModeName(match.game_mode),
		winner,
		score: { radiant: match.radiant_score ?? totals.radiant.kills, dire: match.dire_score ?? totals.dire.kills },
		...(ours.length ? {
			our_players: ours.map(p => `${p.name} (${p.hero})`),
			our_team: ourTeams.length === 1 ? ourTeams[0] : 'both',
			...(ourTeams.length === 1 ? { our_result: ourTeams[0] === winner ? 'win' : 'loss' } : {}),
		} : {}),
		teams: {
			radiant: { ...totals.radiant, towers_left: countBits(match.tower_status_radiant) },
			dire: { ...totals.dire, towers_left: countBits(match.tower_status_dire) },
		},
		players,
	};
}

function playerWon(m) {
	return m.radiant_win === isRadiant(m);
}

// One row per match from /players/{id}/matches or /recentMatches.
function buildPlayerMatchRow(m, heroes = {}) {
	return {
		match_id: m.match_id,
		url: matchUrl(m.match_id),
		date: formatDate(m.start_time),
		hero: heroes[m.hero_id]?.displayName || String(m.hero_id),
		result: playerWon(m) ? 'win' : 'loss',
		kda: `${m.kills}/${m.deaths}/${m.assists}`,
		gpm: m.gold_per_min,
		xpm: m.xp_per_min,
		hero_damage: m.hero_damage,
		tower_damage: m.tower_damage,
		...(m.hero_healing > 0 ? { healing: m.hero_healing } : {}),
		last_hits: m.last_hits,
		duration_min: Math.round(m.duration / 60),
		...(m.party_size > 1 ? { party_size: m.party_size } : {}),
	};
}

function avg(list, field) {
	const values = list.map(m => m[field]).filter(v => typeof v === 'number');
	return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function avg1(list, field) {
	const values = list.map(m => m[field]).filter(v => typeof v === 'number');
	return values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : null;
}

// Aggregate over raw match rows: record, averages, current streak. Matches must be newest-first.
function summarizeMatches(matches) {
	if (!matches.length) return { games: 0 };
	const wins = matches.filter(playerWon).length;
	const deaths = matches.reduce((a, m) => a + (m.deaths || 0), 0);
	const ka = matches.reduce((a, m) => a + (m.kills || 0) + (m.assists || 0), 0);
	const first = playerWon(matches[0]);
	let streak = 0;
	for (const m of matches) {
		if (playerWon(m) !== first) break;
		streak++;
	}
	return {
		games: matches.length,
		wins,
		losses: matches.length - wins,
		winrate_pct: share(wins, matches.length),
		current_streak: `${streak} ${first ? 'побед' : 'поражений'} подряд`,
		avg_kills: avg1(matches, 'kills'),
		avg_deaths: avg1(matches, 'deaths'),
		avg_assists: avg1(matches, 'assists'),
		kda_ratio: +(ka / Math.max(1, deaths)).toFixed(2),
		avg_gpm: avg(matches, 'gold_per_min'),
		avg_hero_damage: avg(matches, 'hero_damage'),
		avg_tower_damage: avg(matches, 'tower_damage'),
		avg_last_hits: avg(matches, 'last_hits'),
		avg_duration_min: Math.round((avg(matches, 'duration') || 0) / 60),
	};
}

// /players/{id}/totals → { kills: avg, ... } for the fields that matter.
const TOTAL_FIELDS = ['kills', 'deaths', 'assists', 'gold_per_min', 'xp_per_min', 'hero_damage', 'tower_damage', 'hero_healing', 'last_hits'];

function averagesFromTotals(totals) {
	const out = {};
	let games = 0;
	for (const t of totals || []) {
		if (!TOTAL_FIELDS.includes(t.field) || !t.n) continue;
		games = Math.max(games, t.n);
		const value = t.sum / t.n;
		out[`avg_${t.field}`] = value < 100 ? +value.toFixed(1) : Math.round(value);
	}
	return { games, ...out };
}

const MIN_HERO_GAMES = 10;

function heroRow(h, heroes) {
	return {
		hero: heroes[h.heroId]?.displayName || String(h.heroId),
		games: h.matchCount,
		wins: h.winCount,
		winrate_pct: share(h.winCount, h.matchCount),
		...(h.lastPlayed ? { last_played: formatDate(h.lastPlayed).slice(0, 10) } : {}),
	};
}

// Hero pool split into most played / best / worst (winrate lists need a minimum sample).
function buildHeroPool(heroStats, heroes = {}, { top = 15, edge = 5 } = {}) {
	const byGames = [...heroStats].sort((a, b) => b.matchCount - a.matchCount);
	const sampled = heroStats.filter(h => h.matchCount >= MIN_HERO_GAMES);
	const byWinrate = [...sampled].sort((a, b) => b.winCount / b.matchCount - a.winCount / a.matchCount);
	return {
		heroes_played: heroStats.length,
		most_played: byGames.slice(0, top).map(h => heroRow(h, heroes)),
		best_winrate: byWinrate.slice(0, edge).map(h => heroRow(h, heroes)),
		worst_winrate: byWinrate.slice(-edge).reverse().map(h => heroRow(h, heroes)),
		note: `best/worst считаются только по героям с ${MIN_HERO_GAMES}+ играми`,
	};
}

module.exports = {
	matchUrl,
	formatDate,
	localDay,
	gameModeName,
	resolveHero,
	resolvePlayerId,
	playerLabel,
	buildMatchView,
	buildPlayerMatchRow,
	summarizeMatches,
	averagesFromTotals,
	buildHeroPool,
	heroRow,
	playerWon,
};
