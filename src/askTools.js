const persona = require('./persona');
const {
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchRecentMatches,
	fetchMatchDetail,
	fetchPeers,
	fetchPlayerTotals,
	fetchPlayerMatches,
} = require('./requests');
const { storage } = require('./storage');
const memory = require('./memory');
const players = require('./players');
const {
	resolveHero, resolvePlayerId, playerLabel, buildMatchView, buildPlayerMatchRow, summarizeMatches,
	averagesFromTotals, buildHeroPool, heroRow, formatDate, matchUrl, playerWon,
} = require('./dotaAnalysis');
const { GPT_MODEL_MINI } = process.env;

const PLAYER_ID = { type: 'string', description: 'player_id из списка игроков (или любой числовой Steam account_id)' };
const HERO = { type: 'string', description: 'Официальное английское имя героя, например "Weaver", "Phantom Assassin"' };

const DOTA_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'get_player_profile',
			description: 'Полный портрет игрока в турбо: винрейт за всё время и за 30 дней, средние показатели (K/D/A, GPM, урон по героям и башням) за 30 дней и за всё время, пул героев (самые частые, лучшие и худшие по винрейту), форма за последние 20 игр и текущая серия. Вызывай первым делом, когда спрашивают про игрока в целом: "как играет X", "что думаешь про X", "я нормально играю?", "на ком мне играть".',
			parameters: { type: 'object', properties: { player_id: PLAYER_ID }, required: ['player_id'] }
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_player_matches',
			description: 'Список матчей игрока в турбо, от новых к старым, с match_id, ссылкой, датой, героем, результатом, K/D/A, GPM, уроном, плюс сводка по выборке (W-L, средние). Фильтры: hero — только матчи на этом герое, days — только за последние N дней. Вызывай для "как X сыграл вчера/на неделе", "последняя игра X на Weaver", "как X играет на герое", а также чтобы найти match_id конкретной игры перед get_match_details.',
			parameters: {
				type: 'object',
				properties: {
					player_id: PLAYER_ID,
					hero: HERO,
					days: { type: 'number', description: 'Только матчи за последние N дней (1 = сутки, 7 = неделя)' },
					count: { type: 'number', description: 'Сколько матчей вернуть (по умолчанию 10, максимум 30)' },
				},
				required: ['player_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_player_heroes',
			description: 'Статистика игрока по героям в турбо за всё время: самые частые, лучшие и худшие по винрейту. С параметром hero — точные цифры по одному герою (игры, победы, винрейт, когда играл последний раз). Вызывай для "винрейт X на герое", "на ком X играет лучше всего", "сколько игр у X на Pudge".',
			parameters: { type: 'object', properties: { player_id: PLAYER_ID, hero: HERO }, required: ['player_id'] }
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_match_details',
			description: 'Полный разбор одного матча по match_id: обе команды, для каждого из 10 игроков — герой, K/D/A, участие в убийствах, net worth и доля в команде, урон и доля в команде, урон по башням, хил, предметы, перцентили против других игроков на том же герое (pct_vs_hero). Наши игроки помечены ours. Вызывай всегда, когда разговор о конкретной игре: "почему слили", "кто затащил", "разбери матч", "что по предметам". match_id бери из get_player_matches / get_group_matches / из сообщения пользователя — никогда не придумывай.',
			parameters: { type: 'object', properties: { match_id: { type: 'string' } }, required: ['match_id'] }
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_last_group_match',
			description: 'Последняя сыгранная турбо-катка любого из наших игроков — сразу с полным разбором, как get_match_details. Вызывай для "последняя катка", "разбери последнюю игру", "как сыграли только что", когда игрок не уточнён.',
			parameters: { type: 'object', properties: {} }
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_group_matches',
			description: 'Список последних турбо-матчей нашей группы (до 20 последних игр каждого игрока): match_id, ссылка, дата, результат и кто из наших на ком играл с K/D/A. Вызывай для "что сегодня/вчера наиграли", "какие были катки", "найди игру, где X и Y играли вместе", а также чтобы выбрать match_id для get_match_details.',
			parameters: {
				type: 'object',
				properties: {
					days: { type: 'number', description: 'Только матчи за последние N дней' },
					count: { type: 'number', description: 'Сколько матчей вернуть (по умолчанию 10, максимум 25)' },
				},
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'compare_players',
			description: 'Сравнительная таблица всех наших игроков за период (по умолчанию 30 дней): игры, W-L, винрейт, средние K/D/A, KDA, GPM, урон по героям и башням, текущая серия, дата последней игры, плюс винрейт за всё время и среднее по группе. Вызывай для "кто тащит, кто балласт", "у кого лучший винрейт", "топ игроков", "у кого какая серия", "кто давно не играл". Один вызов вместо профиля на каждого.',
			parameters: {
				type: 'object',
				properties: { days: { type: 'number', description: 'Период в днях (по умолчанию 30)' } },
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_party_stats',
			description: 'Совместные игры наших игроков в турбо за 30 дней: сколько игр и какой винрейт у каждой пары. С player_id — только напарники этого игрока. Вызывай для "с кем X играет лучше всего", "какая пара самая сильная", "с кем лучше не играть".',
			parameters: { type: 'object', properties: { player_id: PLAYER_ID } }
		}
	},
];

const COMMON_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'web_search',
			description: 'Search the internet for current info (meta, patches, builds, pro scene, anything not in your training data). Use when you need up-to-date information.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Search query in English for best results' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_chat_history',
			description: 'Get chat messages for a time period. Returns text messages and voice transcriptions. Call this tool EVERY TIME the user asks about chat discussions, conversations, what people said, or follows up on a previous chat summary — even if you already called it before. History is available only for the last 7 days. If 0 messages returned — say there are no messages, NEVER invent content.',
			parameters: {
				type: 'object',
				properties: {
					hours_ago: { type: 'number', description: 'Messages from last N hours. Use for relative periods: 1 = last hour, 168 = week. Do NOT use for "сегодня/today" or named days — use date instead.' },
					date: { type: 'string', description: 'Messages for a specific calendar day (YYYY-MM-DD, timezone Europe/Vilnius). ALWAYS use this for "сегодня/today" (pass today\'s date), "вчера/yesterday", named days ("в понедельник", "3 августа"). Examples: today = current date, yesterday = yesterday\'s date.' },
				},
			}
		}
	},
];

const DOTA_TOOL_NAMES = DOTA_TOOLS.map(t => t.function.name);
const ASK_TOOLS = [...DOTA_TOOLS, ...COMMON_TOOLS];

function nameOf(playersMap, playerId) {
	return playerLabel(playersMap, playerId) || String(playerId);
}

function pct(wins, games) {
	return games > 0 ? Math.round((wins / games) * 100) : 0;
}

async function matchView(match, heroes, playersMap) {
	return buildMatchView(match, { heroes, items: await storage.getItems(), playersMap });
}

// Recent turbo games of every tracked player merged into unique matches, newest first.
async function collectGroupMatches(heroes, playersMap) {
	const playerIds = Object.keys(playersMap);
	const lists = await Promise.all(playerIds.map(id => fetchRecentMatches(id, 20).catch(() => [])));
	const byMatch = new Map();
	lists.forEach((matches, idx) => {
		for (const m of matches) {
			if (!byMatch.has(m.match_id)) byMatch.set(m.match_id, { match_id: m.match_id, start_time: m.start_time, duration: m.duration, players: [] });
			byMatch.get(m.match_id).players.push({
				name: nameOf(playersMap, playerIds[idx]),
				hero: heroes[m.hero_id]?.displayName || String(m.hero_id),
				kda: `${m.kills}/${m.deaths}/${m.assists}`,
				result: playerWon(m) ? 'win' : 'loss',
			});
		}
	});
	return [...byMatch.values()].sort((a, b) => b.start_time - a.start_time);
}

// Wraps a handler so args.player_id is always a numeric id (or the call fails with a hint).
function withPlayer(handler, { optional = false } = {}) {
	return async (args, heroes, playersMap) => {
		if (optional && !args.player_id) return handler(args, heroes, playersMap);
		const id = resolvePlayerId(args.player_id, playersMap, players.getTelegramMap());
		if (!id) {
			const known = Object.entries(playersMap).map(([pid, p]) => `${p.name}=${pid}`).join(', ');
			return { error: `Игрок "${args.player_id}" не найден. Передай числовой player_id: ${known}` };
		}
		return handler({ ...args, player_id: id }, heroes, playersMap);
	};
}

const ASK_TOOL_HANDLERS = {
	get_player_profile: async (args, heroes, playersMap) => {
		const id = args.player_id;
		const [wl, totals30, totalsAll, heroStats, recent] = await Promise.all([
			fetchPlayerMatchesStats(id),
			fetchPlayerTotals(id, 30),
			fetchPlayerTotals(id),
			fetchPlayerHeroesStats(id),
			fetchPlayerMatches(id, { limit: 20 }),
		]);
		if (!wl.allTime.matchCount) return { player: nameOf(playersMap, id), error: 'Нет турбо-матчей или профиль закрыт' };
		return {
			player: nameOf(playersMap, id),
			winrate: {
				all_time: { games: wl.allTime.matchCount, wins: wl.allTime.winCount, winrate_pct: pct(wl.allTime.winCount, wl.allTime.matchCount) },
				last_30_days: { games: wl.oneMonth.matchCount, wins: wl.oneMonth.winCount, winrate_pct: pct(wl.oneMonth.winCount, wl.oneMonth.matchCount) },
			},
			averages_last_30_days: averagesFromTotals(totals30),
			averages_all_time: averagesFromTotals(totalsAll),
			last_20_games: summarizeMatches(recent),
			last_5_games: recent.slice(0, 5).map(m => buildPlayerMatchRow(m, heroes)),
			hero_pool: buildHeroPool(heroStats, heroes, { top: 8, edge: 4 }),
		};
	},
	get_player_matches: async (args, heroes, playersMap) => {
		const player = nameOf(playersMap, args.player_id);
		let hero = null;
		if (args.hero) {
			hero = resolveHero(heroes, args.hero);
			if (!hero) return { player, error: `Герой "${args.hero}" не найден — передай официальное английское имя` };
		}
		const count = Math.min(Math.max(args.count || 10, 1), 30);
		const matches = await fetchPlayerMatches(args.player_id, { heroId: hero?.id, days: args.days, limit: count });
		if (!matches.length) {
			return { player, ...(hero ? { hero: hero.displayName } : {}), match_count: 0, note: 'Матчей по этому фильтру нет (или профиль закрыт). Не придумывай — скажи, что игр не найдено.' };
		}
		return {
			player,
			...(hero ? { hero: hero.displayName } : {}),
			...(args.days ? { period_days: args.days } : {}),
			match_count: matches.length,
			summary: summarizeMatches(matches),
			matches: matches.map(m => buildPlayerMatchRow(m, heroes)),
			hint: 'Это только строки статистики игрока. Чтобы оценить конкретную игру (роль, вклад, предметы, сравнение с командой и врагами) — вызови get_match_details по её match_id.',
		};
	},
	get_player_heroes: async (args, heroes, playersMap) => {
		const player = nameOf(playersMap, args.player_id);
		const stats = await fetchPlayerHeroesStats(args.player_id);
		if (!stats.length) return { player, error: 'Нет турбо-матчей или профиль закрыт' };
		if (args.hero) {
			const hero = resolveHero(heroes, args.hero);
			if (!hero) return { player, error: `Герой "${args.hero}" не найден — передай официальное английское имя` };
			const row = stats.find(h => h.heroId === hero.id);
			if (!row) return { player, hero: hero.displayName, games: 0, note: 'Игрок не играл на этом герое в турбо' };
			const rank = [...stats].sort((a, b) => b.matchCount - a.matchCount).findIndex(h => h.heroId === hero.id) + 1;
			return { player, ...heroRow(row, heroes), rank_by_games: rank, heroes_played: stats.length, hint: 'Для разбора самих игр на герое вызови get_player_matches с hero' };
		}
		return { player, ...buildHeroPool(stats, heroes) };
	},
	get_match_details: async (args, heroes, playersMap) => {
		const match = await fetchMatchDetail(args.match_id);
		if (!match?.players?.length) return { error: 'Матч не найден' };
		return matchView(match, heroes, playersMap);
	},
	get_last_group_match: async (_args, heroes, playersMap) => {
		const groupMatches = await collectGroupMatches(heroes, playersMap);
		if (!groupMatches.length) return { error: 'Недавних матчей не найдено' };
		const match = await fetchMatchDetail(groupMatches[0].match_id);
		if (!match?.players?.length) return { error: 'Детали матча недоступны', ...groupMatches[0] };
		return matchView(match, heroes, playersMap);
	},
	get_group_matches: async (args, heroes, playersMap) => {
		let groupMatches = await collectGroupMatches(heroes, playersMap);
		if (args.days) {
			const cutoff = Math.floor(Date.now() / 1000) - args.days * 86400;
			groupMatches = groupMatches.filter(m => m.start_time >= cutoff);
		}
		const count = Math.min(Math.max(args.count || 10, 1), 25);
		if (!groupMatches.length) return { match_count: 0, note: 'Матчей за этот период нет. Не придумывай.' };
		// Tracked players can end up on opposite teams; then the match has no single result for "us".
		const resultOf = m => m.players.every(p => p.result === m.players[0].result) ? m.players[0].result : 'mixed';
		const wins = groupMatches.filter(m => resultOf(m) === 'win').length;
		const losses = groupMatches.filter(m => resultOf(m) === 'loss').length;
		return {
			match_count: groupMatches.length,
			record: `${wins}W-${losses}L`,
			showing: Math.min(count, groupMatches.length),
			matches: groupMatches.slice(0, count).map(m => {
				const result = resultOf(m);
				return {
					match_id: m.match_id,
					url: matchUrl(m.match_id),
					date: formatDate(m.start_time),
					duration_min: Math.round(m.duration / 60),
					result: result === 'mixed' ? 'наши играли друг против друга' : result,
					our_players: m.players.map(p => `${p.name} — ${p.hero} ${p.kda}${result === 'mixed' ? ` (${p.result})` : ''}`),
				};
			}),
		};
	},
	compare_players: async (args, _heroes, playersMap) => {
		const days = Math.min(Math.max(args.days || 30, 1), 365);
		const ids = Object.keys(playersMap);
		const rows = await Promise.all(ids.map(async (id) => {
			const [matches, wl] = await Promise.all([
				fetchPlayerMatches(id, { days, limit: 500 }).catch(() => []),
				fetchPlayerMatchesStats(id).catch(() => null),
			]);
			return {
				player: nameOf(playersMap, id),
				...summarizeMatches(matches),
				...(matches.length ? { last_game: formatDate(matches[0].start_time) } : { note: `не играл за последние ${days} дн.` }),
				...(wl ? { all_time: { games: wl.allTime.matchCount, winrate_pct: pct(wl.allTime.winCount, wl.allTime.matchCount) } } : {}),
			};
		}));
		const active = rows.filter(r => r.games > 0);
		const mean = (field) => active.length ? Math.round(active.reduce((a, r) => a + (r[field] || 0), 0) / active.length) : null;
		return {
			period_days: days,
			group_average: {
				winrate_pct: mean('winrate_pct'), avg_gpm: mean('avg_gpm'),
				avg_hero_damage: mean('avg_hero_damage'), avg_tower_damage: mean('avg_tower_damage'),
			},
			players: rows.sort((a, b) => (b.winrate_pct || 0) - (a.winrate_pct || 0) || b.games - a.games),
			note: 'Меньше 10 игр за период — выборка слабая, выводы осторожные.',
		};
	},
	get_party_stats: async (args, _heroes, playersMap) => {
		const trackedIds = Object.keys(playersMap);
		const tracked = new Set(trackedIds.map(Number));
		const row = (a, b, games, wins) => ({ pair: `${nameOf(playersMap, a)} + ${nameOf(playersMap, b)}`, games, wins, winrate_pct: pct(wins, games) });
		if (args.player_id) {
			const peers = await fetchPeers(args.player_id, 30);
			const pairs = peers.filter(p => tracked.has(p.account_id) && p.games > 0)
				.map(p => row(args.player_id, p.account_id, p.games, p.win))
				.sort((a, b) => b.games - a.games);
			return { period_days: 30, player: nameOf(playersMap, args.player_id), pairs };
		}
		const lists = await Promise.all(trackedIds.map(id => fetchPeers(id, 30).catch(() => [])));
		const byPair = new Map();
		lists.forEach((peers, idx) => {
			for (const p of peers) {
				if (!tracked.has(p.account_id) || !p.games) continue;
				const key = [trackedIds[idx], String(p.account_id)].sort().join(':');
				const prev = byPair.get(key);
				if (!prev || p.games > prev.games) byPair.set(key, { games: p.games, wins: p.win });
			}
		});
		const pairs = [...byPair.entries()]
			.map(([key, v]) => row(...key.split(':'), v.games, v.wins))
			.sort((a, b) => b.games - a.games);
		return { period_days: 30, pairs, note: 'Пары с малым числом игр (<5) не показательны.' };
	},
	web_search: async (args) => {
		try {
			const OpenAI = require('openai');
			const client = new OpenAI();
			const response = await client.responses.create({
				model: GPT_MODEL_MINI,
				tools: [{ type: 'web_search_preview' }],
				input: args.query,
			});
			return { results: response.output_text };
		} catch (err) {
			return { error: err.message };
		}
	},
	get_chat_history: async (args) => {
		let from, to;
		const now = Math.floor(Date.now() / 1000);

		if (args.date) {
			const dayStart = new Date(args.date + 'T00:00:00+03:00');
			from = Math.floor(dayStart.getTime() / 1000);
			to = from + 86400;
		} else {
			const hours = Math.min(args.hours_ago || 24, 168);
			from = now - hours * 3600;
			to = now;
		}

		const messages = memory.getChatMessages(from, to);

		if (!messages.length) return { message_count: 0, note: 'Сообщений за этот период НЕТ. История хранится только 7 дней. НЕ придумывай содержание — скажи пользователю, что данных нет.' };

		const truncated = messages.slice(-300);
		return {
			message_count: messages.length,
			showing: truncated.length,
			messages: truncated.map(m => ({
				time: new Date(m.ts * 1000).toLocaleString('ru-RU', {
					hour: '2-digit', minute: '2-digit',
					day: '2-digit', month: '2-digit',
					timeZone: 'Europe/Vilnius',
				}),
				from: m.name,
				text: m.text.length > 500 ? m.text.slice(0, 500) + '...' : m.text,
				type: m.type,
			}))
		};
	},
};


// persona.tools may list tool names explicitly or use 'dota' for the whole Dota toolset.
for (const name of ['get_player_profile', 'get_player_matches', 'get_player_heroes']) {
	ASK_TOOL_HANDLERS[name] = withPlayer(ASK_TOOL_HANDLERS[name]);
}
ASK_TOOL_HANDLERS.get_party_stats = withPlayer(ASK_TOOL_HANDLERS.get_party_stats, { optional: true });

function getPersonaTools() {
	if (!persona.tools) return ASK_TOOLS;
	const enabled = new Set(persona.tools);
	if (enabled.has('dota')) DOTA_TOOL_NAMES.forEach(n => enabled.add(n));
	return ASK_TOOLS.filter(t => enabled.has(t.function.name));
}

function isDotaTool(name) {
	return DOTA_TOOL_NAMES.includes(name);
}

module.exports = { ASK_TOOLS, ASK_TOOL_HANDLERS, DOTA_TOOL_NAMES, getPersonaTools, isDotaTool };
