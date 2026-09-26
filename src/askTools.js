const persona = require('./persona');
const {
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchRecentMatches,
	fetchMatchDetail,
	fetchPeers,
	fetchPlayerTotals,
} = require('./requests');
const memory = require('./memory');
const { isWin } = require('./utils');
const { GPT_MODEL_MINI } = process.env;

const ASK_TOOLS = [
	{
		type: 'function',
		function: {
			name: 'get_player_winrate',
			description: 'Win/loss stats for a player in turbo. Returns allTime and oneMonth.',
			parameters: {
				type: 'object',
				properties: { player_id: { type: 'string' } },
				required: ['player_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_player_heroes',
			description: 'Top heroes for a player in turbo (sorted by games played). Returns heroId, matchCount, winCount.',
			parameters: {
				type: 'object',
				properties: { player_id: { type: 'string' } },
				required: ['player_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_recent_matches',
			description: 'Recent turbo matches for a player. Use days param to filter by time (e.g. days=1 for yesterday). Returns hero, kills, deaths, assists, gpm, xpm, duration, win/loss, date.',
			parameters: {
				type: 'object',
				properties: {
					player_id: { type: 'string' },
					count: { type: 'number', description: 'How many matches (max 20)' },
					days: { type: 'number', description: 'Only return matches from last N days (e.g. 1 = last 24h)' }
				},
				required: ['player_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_player_peers',
			description: 'Who this player plays with most in turbo (last 30 days). Returns peer account_id, games, wins.',
			parameters: {
				type: 'object',
				properties: { player_id: { type: 'string' } },
				required: ['player_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_match_details',
			description: 'Full details of a specific match. Returns all players with hero, kills, deaths, assists, networth, damage, etc.',
			parameters: {
				type: 'object',
				properties: { match_id: { type: 'string' } },
				required: ['match_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_player_totals',
			description: 'Aggregated totals for a player in turbo: kills, deaths, assists, gold_per_min, xp_per_min, hero_damage, tower_damage, last_hits, duration, etc. Each field has sum and n (count).',
			parameters: {
				type: 'object',
				properties: { player_id: { type: 'string' } },
				required: ['player_id']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_last_group_match',
			description: 'Find the most recent turbo match played by any tracked player. Returns full match details with all 10 players, marking tracked ones. Use for "last game", "latest match", "последняя катка". Matches with same match_id from different players are the same game.',
			parameters: {
				type: 'object',
				properties: {},
			}
		}
	},
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

const ASK_TOOL_HANDLERS = {
	get_player_winrate: async (args, _heroes, playersMap) => {
		const name = playersMap[args.player_id]?.name || args.player_id;
		const stats = await fetchPlayerMatchesStats(args.player_id);
		return { player: name, ...stats };
	},
	get_player_heroes: async (args, heroes, playersMap) => {
		const name = playersMap[args.player_id]?.name || args.player_id;
		const stats = await fetchPlayerHeroesStats(args.player_id);
		return {
			player: name,
			heroes: stats.slice(0, 20).map(h => ({
				hero: heroes[h.heroId]?.displayName || h.heroId,
				games: h.matchCount,
				wins: h.winCount,
				winrate: ((h.winCount / h.matchCount) * 100).toFixed(1) + '%'
			}))
		};
	},
	get_recent_matches: async (args, heroes, playersMap) => {
		const name = playersMap[args.player_id]?.name || args.player_id;
		const count = Math.min(args.count || 10, 20);
		let matches = await fetchRecentMatches(args.player_id, count);
		if (args.days) {
			const cutoff = Math.floor(Date.now() / 1000) - args.days * 86400;
			matches = matches.filter(m => m.start_time >= cutoff);
		}
		return {
			player: name,
			match_count: matches.length,
			matches: matches.map(m => ({
				match_id: m.match_id,
				hero: heroes[m.hero_id]?.displayName || m.hero_id,
				win: isWin(m),
				kills: m.kills, deaths: m.deaths, assists: m.assists,
				gpm: m.gold_per_min, xpm: m.xp_per_min,
				duration_min: Math.round(m.duration / 60),
				date: new Date(m.start_time * 1000).toLocaleDateString('ru-RU'),
			}))
		};
	},
	get_player_peers: async (args, _heroes, playersMap) => {
		const name = playersMap[args.player_id]?.name || args.player_id;
		const peers = await fetchPeers(args.player_id, 30);
		const trackedIds = new Set(Object.keys(playersMap).map(Number));
		return {
			player: name,
			peers: peers
				.filter(p => trackedIds.has(p.account_id))
				.map(p => ({
					name: playersMap[String(p.account_id)]?.name || p.account_id,
					games: p.games, wins: p.win,
					winrate: ((p.win / p.games) * 100).toFixed(1) + '%'
				}))
		};
	},
	get_match_details: async (args, heroes) => {
		const match = await fetchMatchDetail(args.match_id);
		if (!match) return { error: 'Match not found' };
		return {
			match_id: match.match_id,
			duration_min: Math.round(match.duration / 60),
			radiant_win: match.radiant_win,
			players: match.players.map(p => ({
				name: p.personaname, hero: heroes[p.hero_id]?.displayName || p.hero_id,
				kills: p.kills, deaths: p.deaths, assists: p.assists,
				networth: p.net_worth || p.total_gold,
				hero_damage: p.hero_damage, tower_damage: p.tower_damage,
				gpm: p.gold_per_min, team: p.player_slot < 128 ? 'radiant' : 'dire',
			}))
		};
	},
	get_player_totals: async (args, _heroes, playersMap) => {
		const name = playersMap[args.player_id]?.name || args.player_id;
		const totals = await fetchPlayerTotals(args.player_id);
		const useful = ['kills', 'deaths', 'assists', 'gold_per_min', 'xp_per_min',
			'hero_damage', 'tower_damage', 'last_hits', 'duration', 'level'];
		const filtered = {};
		totals.forEach(t => {
			if (useful.includes(t.field)) {
				filtered[t.field] = { total: t.sum, games: t.n, avg: t.n > 0 ? Math.round(t.sum / t.n) : 0 };
			}
		});
		return { player: name, totals: filtered };
	},
	get_last_group_match: async (_args, heroes, playersMap) => {
		const playerIds = Object.keys(playersMap);
		const allMatches = await Promise.all(playerIds.map(id => fetchRecentMatches(id, 10)));
		const matchPlayers = {};
		allMatches.forEach((matches, idx) => {
			matches.forEach(m => {
				if (!matchPlayers[m.match_id]) matchPlayers[m.match_id] = { time: m.start_time, players: [] };
				matchPlayers[m.match_id].players.push(playerIds[idx]);
			});
		});
		const groupMatches = Object.entries(matchPlayers)
			.sort((a, b) => b[1].time - a[1].time);
		if (!groupMatches.length) return { error: 'No recent matches found' };
		const matchId = groupMatches[0][0];
		const match = await fetchMatchDetail(matchId);
		if (!match) return { error: 'Match details unavailable' };
		const trackedIds = new Set(playerIds.map(Number));
		return {
			match_id: match.match_id,
			duration_min: Math.round(match.duration / 60),
			radiant_win: match.radiant_win,
			date: new Date(match.start_time * 1000).toLocaleDateString('ru-RU'),
			players: match.players.map(p => ({
				name: playersMap[String(p.account_id)]?.name || p.personaname || '???',
				is_tracked: trackedIds.has(p.account_id),
				hero: heroes[p.hero_id]?.displayName || '???',
				team: p.player_slot < 128 ? 'radiant' : 'dire',
				win: p.radiant_win === (p.player_slot < 128),
				kills: p.kills, deaths: p.deaths, assists: p.assists,
				gpm: p.gold_per_min, networth: p.net_worth || p.total_gold,
				hero_damage: p.hero_damage, tower_damage: p.tower_damage,
			}))
		};
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

function getPersonaTools() {
	if (!persona.tools) return ASK_TOOLS;
	const enabled = new Set(persona.tools);
	return ASK_TOOLS.filter(t => enabled.has(t.function.name));
}

module.exports = { ASK_TOOLS, ASK_TOOL_HANDLERS, getPersonaTools };
