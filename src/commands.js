const { PLAYERS_IDS, PLAYER_TELEGRAM_MAP } = require('./constants');
const {
	fetchMatchesData,
	fetchPlayersData,
	fetchPlayerMatchesStats,
	fetchPlayerHeroesStats,
	fetchLastMatches,
	fetchRecentMatches,
	fetchMatchDetail,
	fetchLastMatchData,
	fetchPeers,
	fetchPlayerTotals,
} = require('./requests');
const { storage } = require('./storage');
const { secondsToTime, convertMiliseconds, isWin, escapeHTML } = require('./utils');
const { GPT_MODEL, GPT_MODEL_MINI } = process.env;

const PERIOD_LABELS = {
	yesterday: 'Вчерашние матчи',
	today: 'Матчи за сутки',
	week: 'Матчи за неделю',
};

async function sendReport(ctx, period = 'yesterday') {
	const matchesData = await fetchMatchesData(period);
	const playersData = await fetchPlayersData();
	const heroes = await storage.getHeroes();

	const parsedMatchesData = parseMatchesData(matchesData);

	const aiReport = await generateAIReport(parsedMatchesData, playersData, heroes, period);
	if (aiReport) {
		await ctx.replyWithHTML(aiReport);
		const mvp = getMVP(parsedMatchesData, playersData);
		if (mvp.avatar) {
			await ctx.replyWithPhoto(mvp.avatar);
		}
		return;
	}

	const summary = getSummary(parsedMatchesData, playersData, period);
	const mvp = getMVP(parsedMatchesData, playersData);
	const awards = getAwards(parsedMatchesData, playersData, heroes);
	await sendMatchesSummary(ctx, summary);
	await sendMVP(ctx, mvp);
	if (awards) {
		await ctx.replyWithHTML(awards);
	}
}

async function sendMatchesSummary(ctx, message) {
	await ctx.replyWithHTML(message);
}

async function sendMVP(ctx, mvp) {
	const message = `
		<blockquote>
		<b>MVP - ${mvp.name}</b>
		WL: ${mvp.wins} - ${mvp.loses}
		Avg KDA: ${mvp.kdaAvg.toFixed(1)}
		Avg Networth: ${mvp.nwAvg.toFixed(0)}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);

	if (mvp.avatar) {
		await ctx.replyWithPhoto(mvp.avatar);
	}
}

async function sendPlayersWinrate(ctx, period = 'allTime') {
	const playersMap = await storage.getPlayers();
	const requests = Object.keys(playersMap).map(id => fetchPlayerMatchesStats(id));
	const response = await Promise.all(requests);
	const periodString = period === 'allTime' ? 'All time' : 'Last month';
	const players = Object.values(playersMap);

	const playersStats = response.map((stats, index) => {
		const turboStats = stats[period];

		if (!turboStats || turboStats.matchCount === 0) {
			return `
			<b>${players[index].name}</b>
			No turbo matches
		`;
		}

		return `
			<b>${players[index].name}</b>
			Matches: ${turboStats.matchCount}
			Winrate: ${(turboStats.winCount / turboStats.matchCount * 100).toFixed(1)}%
		`;
	})

	const message = `
		<blockquote>
		<b>${periodString} turbo matches</b>
		${playersStats.join('')}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendPlayerWinrate(ctx, playerId, period = 'allTime') {
	const players = await storage.getPlayers();
	const stats = await fetchPlayerMatchesStats(playerId);
	const turboStats = stats[period];

	if (!players[playerId]) {
		return;
	}

	if (!turboStats || turboStats.matchCount === 0) {
		const message = `
		<blockquote>
		<b>${players[playerId].name}</b>
		No turbo matches found
		</blockquote>
	`;
		await ctx.replyWithHTML(message);
		return;
	}

	const periodString = period === 'allTime' ? 'All time' : 'Last month';

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b>

		${periodString} turbo matches: ${turboStats.matchCount}
		Winrate: ${(turboStats.winCount / turboStats.matchCount * 100).toFixed(1)}%
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchStats(ctx, playerId) {
	const players = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const matches = await fetchLastMatches(playerId, 1);

	if (!matches.length || !players[playerId]) {
		return;
	}

	const match = matches[0];
	const won = isWin(match);
	const hero = heroes[match.hero_id];

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b> <a href="https://www.opendota.com/matches/${match.match_id}">${won ? 'won' : 'lost'} last match on ${hero?.displayName || '???'}</a>
		${(new Date(match.start_time * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		Duration: ${secondsToTime(match.duration)}
		KDA: ${match.kills} - ${match.deaths} - ${match.assists}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchesList(ctx) {
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchLastMatches(id, 5)));

	const allMatches = [];
	responses.forEach((matches, idx) => {
		if (!matches) return;
		matches.forEach(match => {
			allMatches.push({
				matchId: match.match_id,
				playerId: playerIds[idx],
				playerName: playersMap[playerIds[idx]].name,
				heroName: heroes[match.hero_id]?.displayName || '???',
				isVictory: isWin(match),
				kills: match.kills,
				deaths: match.deaths,
				assists: match.assists,
				startDateTime: match.start_time,
			});
		});
	});

	allMatches.sort((a, b) => b.startDateTime - a.startDateTime);
	const top10 = allMatches.slice(0, 10);

	if (!top10.length) {
		await ctx.replyWithHTML('<blockquote>Нет недавних матчей</blockquote>');
		return;
	}

	return { matches: top10 };
}

async function sendMatchDetails(ctx, matchId, playerId) {
	const players = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const match = await fetchMatchDetail(matchId);

	if (!match || !players[playerId]) return;

	const p = match.players.find(pl => pl.account_id === Number(playerId));
	if (!p) return;

	const hero = heroes[p.hero_id];
	const won = p.radiant_win === (p.player_slot < 128);

	const message = `
		<blockquote>
		<b>${players[playerId].name}</b> <a href="https://www.opendota.com/matches/${match.match_id}">${won ? 'won' : 'lost'} on ${hero?.displayName || '???'}</a>
		${(new Date(match.start_time * 1000)).toLocaleString('ru-RU', { timeZone: 'UTC' })} (UTC)

		Duration: ${secondsToTime(match.duration)}
		KDA: ${p.kills} - ${p.deaths} - ${p.assists}
		Networth: ${p.net_worth || p.total_gold || 'N/A'}
		Level: ${p.level}

		Hero DMG: ${p.hero_damage}
		Tower DMG: ${p.tower_damage}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);

	const analysis = await generateMatchAnalysis(match, playerId, players, heroes);
	if (analysis) {
		await ctx.replyWithHTML(`<blockquote>${escapeHTML(analysis)}</blockquote>`);
	}
}

async function sendLastPlayTime(ctx) {
	const playersMap = await storage.getPlayers();
	const requests = Object.keys(playersMap).map(id => fetchLastMatchData(id));
	const response = await Promise.all(requests);
	const players = Object.values(playersMap);

	const timeStats = response.map((match, index) => {
		if (!match) {
			return `${players[index].name}: no matches found`;
		}
		const endTime = (match.start_time + match.duration) * 1000;
		const time = Date.now() - endTime;
		return `${players[index].name}: ${convertMiliseconds(time)}`;
	});

	const message = `
		<blockquote>
		<b>Time without Dota 2</b>
		\n${timeStats.join('\n')}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendSafeHTML(ctx, html) {
	try {
		await ctx.replyWithHTML(html);
	} catch (_) {
		const plain = html.replace(/<[^>]+>/g, '');
		await ctx.reply(plain);
	}
}

async function deleteMessage(ctx) {
	try {
		await ctx.deleteMessage(ctx.update.message.messageId);
	} catch(error) {
		console.log(error);
	}
}

async function deleteAction(ctx) {
	try {
		await ctx.deleteMessage(ctx.update.callback_query.message.messageId);
	} catch(error) {
		console.log(error);
	}
}

////// PARSER //////
function parseMatchesData(matchesByPlayer) {
	const result = {
		players: {},
		summary: {
			longestMatchDuration: null,
			shortestMatchDuration: Infinity,
			wins: {},
			loses: {},
		},
		awards: {
			feeder: { steamAccountId: null, value: 0, heroId: null },
			farmer: { steamAccountId: null, value: 0, heroId: null },
			destroyer: { steamAccountId: null, value: 0, heroId: null },
			carry: { steamAccountId: null, value: 0, heroId: null },
		}
	};

	matchesByPlayer.forEach((playerMatches) => {
		playerMatches.forEach((m) => {
			const steamAccountId = m.steamAccountId;
			const won = isWin(m);
			const networth = Math.round(m.gold_per_min * m.duration / 60);

			if (!result.players[steamAccountId]) {
				result.players[steamAccountId] = {
					wins: 0, loses: 0, kdas: [], gpms: [], xpms: [], nws: []
				};
			}

			if (won) {
				result.players[steamAccountId].wins++;
				result.summary.wins[m.match_id] = true;
			} else {
				result.players[steamAccountId].loses++;
				result.summary.loses[m.match_id] = true;
			}

			result.players[steamAccountId].kdas.push((m.kills + m.assists) / (m.deaths || 1));
			result.players[steamAccountId].gpms.push(m.gold_per_min);
			result.players[steamAccountId].xpms.push(m.xp_per_min);
			result.players[steamAccountId].nws.push(networth);

			if (m.deaths > result.awards.feeder.value) {
				result.awards.feeder = { steamAccountId, value: m.deaths, heroId: m.hero_id };
			}
			if (m.gold_per_min > result.awards.farmer.value) {
				result.awards.farmer = { steamAccountId, value: m.gold_per_min, heroId: m.hero_id };
			}
			if (m.tower_damage > result.awards.destroyer.value) {
				result.awards.destroyer = { steamAccountId, value: m.tower_damage, heroId: m.hero_id };
			}
			if (networth > result.awards.carry.value) {
				result.awards.carry = { steamAccountId, value: networth, heroId: m.hero_id };
			}

			if (m.duration > result.summary.longestMatchDuration) {
				result.summary.longestMatchDuration = m.duration;
			}

			if (m.duration < result.summary.shortestMatchDuration) {
				result.summary.shortestMatchDuration = m.duration;
			}
		});
	});

	return result;
}

function getSummary(data, playersMap, period = 'yesterday') {
	const wins = Object.keys(data.summary.wins).length;
	const loses = Object.keys(data.summary.loses).length;
	const players = Object.keys(data.players).map((playerId) => playersMap[playerId].name);
	const stats = {};

	if (!players.length) {
		return 'Всем похуй на игру...';
	}

	Object.entries(data.players).forEach(([key, value]) => {
		const maxKDA = Math.max(...value.kdas);
		const maxNW = Math.max(...value.nws);
		const maxGPM = Math.max(...value.gpms);

		if (maxKDA > (stats.topKDA?.value || 0)) {
			stats.topKDA = {
				name: playersMap[key].name,
				value: maxKDA
			}
		}

		if (maxNW > (stats.topNW?.value || 0)) {
			stats.topNW = {
				name: playersMap[key].name,
				value: maxNW
			}
		}

		if (maxGPM > (stats.topGPM?.value || 0)) {
			stats.topGPM = {
				name: playersMap[key].name,
				value: maxGPM
			}
		}
	});

	let message = `<blockquote><b>${PERIOD_LABELS[period] || PERIOD_LABELS.yesterday}</b>\n\n`;

	if (players.length === 1) {
		message += `The only strong man - ${players[0]}. Respect!`;
	} else {
		message += `Strong men - ${players.join(', ')}.`;
	}

	message += `\nWL: ${wins} - ${loses}`;
	message += `\nLongest match - ${secondsToTime(data.summary.longestMatchDuration)}`;
	message += `\nShortest match - ${secondsToTime(data.summary.shortestMatchDuration)}`;
	message += '\n';
	message += `\nBest KDA: ${stats.topKDA.value.toFixed(1)} (${stats.topKDA.name})`;
	message += `\nBest Networth: ${stats.topNW.value} (${stats.topNW.name})`;
	message += '</blockquote>';

	return message;
}

function getMVP(data, playersMap) {
	let mvp = {};

	Object.entries(data.players).forEach(([key, value]) => {
		const {
			wins, loses, kdas, nws
		} = value;
		const totalGames = wins + loses;
		const winrate = totalGames > 0 ? wins / totalGames : 0;
		const kdaAvg = kdas.reduce((a, b) => a + b, 0) / kdas.length;
		const nwAvg = nws.reduce((a, b) => a + b, 0) / nws.length;
		const score = winrate * 50 + kdaAvg * 10 + nwAvg / 500 + totalGames * 2;

		if (score > (mvp.score || 0)) {
			const { avatar, name} = playersMap[key];

			mvp = {
				avatar,
				name,
				score,
				wins,
				loses,
				kdaAvg,
				nwAvg
			}
		}
	});

	return mvp;
}

function getAwards(data, playersMap, heroes) {
	const { awards } = data;
	if (!awards.feeder.steamAccountId) return null;

	const AWARD_CONFIG = [
		{ key: 'feeder', label: 'Фидер', unit: 'смертей' },
		{ key: 'farmer', label: 'Фармер', unit: 'GPM' },
		{ key: 'destroyer', label: 'Разрушитель', unit: 'tower dmg' },
		{ key: 'carry', label: 'Керри', unit: 'networth' },
	];

	const lines = AWARD_CONFIG.map(({ key, label, unit }) => {
		const award = awards[key];
		const name = playersMap[award.steamAccountId]?.name || 'Unknown';
		const hero = heroes[award.heroId]?.displayName || '';
		return `<b>${label}</b>: ${name} (${hero}, ${award.value} ${unit})`;
	});

	return `<blockquote><b>Награды</b>\n${lines.join('\n')}</blockquote>`;
}

async function sendHeroesStats(ctx) {
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchPlayerHeroesStats(id)));

	const playerStats = responses.map((heroPerf, index) => {
		const name = playersMap[playerIds[index]].name;
		if (!heroPerf || !heroPerf.length) return `<b>${name}</b>: нет данных`;
		const sorted = heroPerf.sort((a, b) => b.matchCount - a.matchCount).slice(0, 3);
		const heroLines = sorted.map((h, i) => {
			const wr = ((h.winCount / h.matchCount) * 100).toFixed(1);
			return `  ${i + 1}. ${heroes[h.heroId]?.displayName || '???'} — ${wr}% (${h.matchCount} игр)`;
		}).join('\n');
		return `<b>${name}</b>\n${heroLines}`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Топ-3 героев в турбо (за все время)</b>\n\n${playerStats.join('\n\n')}</blockquote>`);
}

async function sendStreaks(ctx) {
	const playersMap = await storage.getPlayers();
	const playerIds = Object.keys(playersMap);
	const responses = await Promise.all(playerIds.map(id => fetchRecentMatches(id)));

	const streakLines = responses.map((matches, index) => {
		const name = playersMap[playerIds[index]].name;
		if (!matches || !matches.length) return `${name}: нет матчей`;

		const firstResult = isWin(matches[0]);
		let count = 0;
		for (const match of matches) {
			if (isWin(match) === firstResult) {
				count++;
			} else {
				break;
			}
		}
		const type = firstResult ? 'побед' : 'поражений';
		const emoji = firstResult ? '🟢' : '🔴';
		return `${emoji} ${name}: ${count} ${type} подряд`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Текущие серии (последние 20 матчей)</b>\n\n${streakLines.join('\n')}</blockquote>`);
}

async function sendPartyStats(ctx) {
	const playersMap = await storage.getPlayers();
	const playerIds = Object.keys(playersMap);
	const trackedSet = new Set(playerIds.map(Number));

	const responses = [];
	for (const id of playerIds) {
		try {
			responses.push(await fetchPeers(id, 30));
		} catch (_) {
			responses.push([]);
		}
	}

	const pairStats = {};
	responses.forEach((peers, idx) => {
		const pid = playerIds[idx];
		if (!peers) return;
		peers.forEach(peer => {
			if (trackedSet.has(peer.account_id)) {
				const key = [pid, String(peer.account_id)].sort().join(':');
				if (!pairStats[key]) {
					pairStats[key] = { games: 0, wins: 0, players: [pid, String(peer.account_id)] };
				}
				pairStats[key].games = Math.max(pairStats[key].games, peer.games);
				pairStats[key].wins = Math.max(pairStats[key].wins, peer.win);
			}
		});
	});

	const pairs = Object.values(pairStats).filter(p => p.games > 0).sort((a, b) => b.games - a.games);

	if (!pairs.length) {
		await ctx.replyWithHTML('<blockquote>Нет совместных матчей в турбо за месяц</blockquote>');
		return;
	}

	const lines = pairs.slice(0, 15).map(p => {
		const name1 = playersMap[p.players[0]]?.name || p.players[0];
		const name2 = playersMap[p.players[1]]?.name || p.players[1];
		const wr = ((p.wins / p.games) * 100).toFixed(1);
		return `${name1} + ${name2}: ${p.games} игр, ${wr}% WR`;
	});

	await ctx.replyWithHTML(`<blockquote><b>Совместные игры в турбо (месяц)</b>\n\n${lines.join('\n')}</blockquote>`);
}

async function generateChallenge(ctx, playerId) {
	const OpenAI = require('openai');
	const client = new OpenAI();

	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();

	const isRandom = playerId === 'random';
	const targetIds = isRandom ? Object.keys(playersMap) : [playerId];

	const heroResponses = await Promise.all(targetIds.map(id => fetchPlayerHeroesStats(id)));
	const playerContext = heroResponses.map((heroPerf, idx) => {
		const name = playersMap[targetIds[idx]]?.name || 'Unknown';
		if (!heroPerf || !heroPerf.length) return `${name}: нет данных`;
		const topHeroes = heroPerf.sort((a, b) => b.matchCount - a.matchCount).slice(0, 10);
		const heroList = topHeroes.map(h => `${heroes[h.heroId]?.displayName || '???'} (${h.matchCount} игр, ${(h.winCount / h.matchCount * 100).toFixed(0)}%)`).join(', ');
		return `${name}: ${heroList}`;
	}).join('\n');

	const targetName = isRandom ? null : playersMap[playerId]?.name;

	const systemPrompt = `Ты генерируешь челленджи для друзей, играющих в Dota 2 Turbo. Русский язык, мат и сленг ок. Твоя личность — Билли Херрингтон. Не упоминай гачи напрямую, просто вставляй реплики из гачи-видео как свои фразы (1 за челлендж, к месту). Челлендж должен быть конкретным.

ПРАВИЛА:
- Один конкретный челлендж на 1 игру. Не "постарайтесь", а чёткое условие.
- Челлендж должен быть проверяем по результату матча: конкретный герой, конкретный итем, конкретная цифра (kills/deaths/GPM/tower dmg).
- Используй статистику: если у игрока 70% WR на герое — заставь играть на худшем. Если фармер — запрети покупать BKB. Если фидер — челлендж на 0 смертей.
- Будь дерзким и смешным, подъёбывай по статистике.
- 2-3 предложения максимум. Без воды, без "удачи!", без объяснений зачем.
- Не используй markdown и HTML.`;

	const userPrompt = isRandom
		? `Статистика игроков (топ герои в турбо):\n${playerContext}\n\nОдин челлендж для всей группы.`
		: `Статистика игрока (топ герои в турбо):\n${playerContext}\n\nОдин челлендж для ${targetName}.`;

	const response = await client.chat.completions.create({
		model: GPT_MODEL_MINI,
		max_tokens: 200,
		messages: [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt }
		]
	});

	const challenge = response.choices[0].message.content;
	const title = isRandom ? '🎲 Челлендж' : `🎲 Челлендж для ${targetName}`;
	await ctx.replyWithHTML(`<blockquote><b>${title}</b>\n\n${challenge}</blockquote>`);
}

async function generateAIReport(data, playersMap, heroes, period) {
	const playerLines = Object.entries(data.players).map(([id, stats]) => {
		const name = playersMap[id]?.name || 'Unknown';
		const total = stats.wins + stats.loses;
		const wr = ((stats.wins / total) * 100).toFixed(0);
		const kdaAvg = (stats.kdas.reduce((a, b) => a + b, 0) / stats.kdas.length).toFixed(1);
		const nwAvg = Math.round(stats.nws.reduce((a, b) => a + b, 0) / stats.nws.length);
		const gpmAvg = Math.round(stats.gpms.reduce((a, b) => a + b, 0) / stats.gpms.length);
		return `${name}: ${stats.wins}W-${stats.loses}L (${wr}%), KDA ${kdaAvg}, GPM ${gpmAvg}, NW ${nwAvg}`;
	});

	if (!playerLines.length) return null;

	const wins = Object.keys(data.summary.wins).length;
	const loses = Object.keys(data.summary.loses).length;

	const { awards } = data;
	const awardLines = [
		`Фидер: ${playersMap[awards.feeder.steamAccountId]?.name} на ${heroes[awards.feeder.heroId]?.displayName} (${awards.feeder.value} смертей)`,
		`Фармер: ${playersMap[awards.farmer.steamAccountId]?.name} на ${heroes[awards.farmer.heroId]?.displayName} (${awards.farmer.value} GPM)`,
		`Разрушитель: ${playersMap[awards.destroyer.steamAccountId]?.name} на ${heroes[awards.destroyer.heroId]?.displayName} (${awards.destroyer.value} tower dmg)`,
		`Керри: ${playersMap[awards.carry.steamAccountId]?.name} на ${heroes[awards.carry.heroId]?.displayName} (${awards.carry.value} networth)`,
	];

	const mvp = getMVP(data, playersMap);
	const periodLabel = PERIOD_LABELS[period] || PERIOD_LABELS.yesterday;

	const playerCount = Object.keys(data.players).length;
	const matchCount = wins + loses;

	const context = [
		`Период: ${periodLabel}`,
		`Всего матчей: ${matchCount}, общий счёт: ${wins}W-${loses}L`,
		`Играло: ${playerCount} чел.`,
		`Самый длинный матч: ${secondsToTime(data.summary.longestMatchDuration)}`,
		`Самый короткий матч: ${secondsToTime(data.summary.shortestMatchDuration)}`,
		'',
		'Игроки:',
		...playerLines,
		'',
		'Награды:',
		...awardLines,
		'',
		`MVP: ${mvp.name} (${mvp.wins}W-${mvp.loses}L, KDA ${mvp.kdaAvg.toFixed(1)}, NW ${mvp.nwAvg.toFixed(0)})`,
	].join('\n');

	const lengthGuide = matchCount <= 3 ? '50-80 слов' : matchCount <= 8 ? '80-150 слов' : '150-200 слов';

	try {
		const OpenAI = require('openai');
		const client = new OpenAI();
		const response = await client.chat.completions.create({
			model: GPT_MODEL,
			max_tokens: 600,
			messages: [
				{ role: 'system', content: `Ты — дерзкий комментатор Dota 2 для чата друзей. Пиши на русском. Твоя личность — Билли Херрингтон. Не упоминай гачи напрямую, просто вставляй реплики из гачи-видео как свои фразы (1-3 за текст, к месту).

ЖЁСТКИЕ ПРАВИЛА:
- Пиши ТОЛЬКО по данным ниже. Не придумывай имена, события, цифры, которых нет в данных.
- Каждое имя в тексте должно быть из списка игроков. Никаких выдуманных прозвищ.
- Если факт не следует из данных — не пиши его.

СТИЛЬ:
- Тон — дерзкий и циничный, без позитивщины. Никаких "герой!", "дружище!", "молодцы!", "жги!"
- Мат и дота-сленг приветствуются
- Издевайся над фидерами, тащеров признавай без восторгов
- Подмечай контрасты: если у кого-то 100% WR а у другого 0% — это смешно. Если KDA 1.0 — это жёстко.
- MVP и главный фидер — обязательные персонажи

ФОРМАТ:
- Сплошной текст, без заголовков, без списков. Форматирование: Telegram HTML (<b>, <i>). Не используй markdown (никаких звёздочек и обратных кавычек)
- Длина: ${lengthGuide}. Мало матчей = короткий текст. Не лей воду.
- Заверши частушкой (4 строки с рифмой) если матчей больше 3. Если матчей мало — без частушки.` },
				{ role: 'user', content: context }
			]
		});
		const text = response.choices[0].message.content;
		return `<blockquote><b>${periodLabel}</b>\n\n${text}</blockquote>`;
	} catch (err) {
		console.error('AI report generation error:', err.message);
		return null;
	}
}

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
};

const askChatHistory = new Map();
const ASK_HISTORY_TTL = 8 * 60 * 60 * 1000;
const ASK_HISTORY_MAX = 200;

let billyMood = 5;
const billyAttitude = new Map();

function getAttitude(user) {
	if (!billyAttitude.has(user)) billyAttitude.set(user, 5);
	return billyAttitude.get(user);
}

function adjustMood(delta) {
	const prev = billyMood;
	billyMood = Math.max(1, Math.min(10, billyMood + delta));
	console.log(`Mood: ${prev} → ${billyMood} (delta: ${delta > 0 ? '+' : ''}${delta})`);
}

function adjustAttitude(user, delta) {
	const prev = getAttitude(user);
	billyAttitude.set(user, Math.max(1, Math.min(10, prev + delta)));
	console.log(`Attitude [${user}]: ${prev} → ${billyAttitude.get(user)} (delta: ${delta > 0 ? '+' : ''}${delta})`);
}

function clampDelta(n) {
	return Math.max(-2, Math.min(2, Math.round(Number(n) || 0)));
}

function parseAskResponse(raw) {
	try {
		const parsed = JSON.parse(raw);
		return {
			answer: parsed.answer || raw,
			mood_delta: clampDelta(parsed.mood_delta),
			attitude_delta: clampDelta(parsed.attitude_delta),
		};
	} catch {
		return { answer: raw, mood_delta: 0, attitude_delta: 0 };
	}
}

function getMoodPrompt(authorTag) {
	const attitude = getAttitude(authorTag);
	const effective = Math.round((billyMood + attitude * 2) / 3);

	let moodLine;
	if (billyMood <= 3) moodLine = `Общее настроение: ${billyMood}/10 — ты в хорошем расположении духа.`;
	else if (billyMood <= 6) moodLine = `Общее настроение: ${billyMood}/10 — стандартный режим.`;
	else moodLine = `Общее настроение: ${billyMood}/10 — ты на взводе, раздражён.`;

	let attitudeLine;
	if (attitude <= 3) attitudeLine = `Отношение к ${authorTag}: ${attitude}/10 — тебе нравится этот человек, он заслужил уважение.`;
	else if (attitude <= 6) attitudeLine = `Отношение к ${authorTag}: ${attitude}/10 — нейтральное, обычный чувак.`;
	else attitudeLine = `Отношение к ${authorTag}: ${attitude}/10 — этот человек тебя бесит, ты его не уважаешь.`;

	let styleLine;
	if (effective <= 3) styleLine = 'Итог: подъёбывай по-дружески, без злобы. Можешь похвалить. Но не превращайся в няшку.';
	else if (effective <= 6) styleLine = 'Итог: стандартный дерзкий и циничный режим.';
	else styleLine = 'Итог: жёстко подъёбывай, не щади. Можешь быть откровенно токсичным. Мат через слово. Но остроумно.';

	return `${moodLine}\n${attitudeLine}\n${styleLine}`;
}

function pruneAskHistory() {
	if (askChatHistory.size <= ASK_HISTORY_MAX) return;
	const now = Date.now();
	for (const [id, entry] of askChatHistory) {
		if (now - entry.ts > ASK_HISTORY_TTL) askChatHistory.delete(id);
	}
	if (askChatHistory.size > ASK_HISTORY_MAX) {
		const oldest = [...askChatHistory.entries()].sort((a, b) => a[1].ts - b[1].ts);
		while (askChatHistory.size > ASK_HISTORY_MAX) {
			askChatHistory.delete(oldest.shift()[0]);
		}
	}
}

async function handleAsk(ctx) {
	const messageId = ctx.message.message_id;
	const reply = (text) => ctx.reply(text, { reply_parameters: { message_id: messageId } });
	const question = ctx.message.text.replace(/^\/(ask|billy)\s*/, '').trim();
	if (!question) {
		await reply('Напиши вопрос после команды, например:\n/billy кто больше всех фидит на pudge?');
		return;
	}

	const OpenAI = require('openai');
	const client = new OpenAI();
	let playersMap, heroes;
	try {
		playersMap = await storage.getPlayers();
		heroes = await storage.getHeroes();
	} catch (err) {
		console.error('Storage fetch failed:', err.message);
		playersMap = {};
		heroes = {};
	}

	const playerList = Object.entries(playersMap)
		.map(([id, data]) => {
			const tg = PLAYER_TELEGRAM_MAP[Number(id)] || '';
			return `${data.name} (id: ${id}, telegram: ${tg})`;
		})
		.join('\n');

	const fromUser = ctx.message.from;
	const authorTag = fromUser.username ? `@${fromUser.username}` : fromUser.first_name;

	const messages = [
		{ role: 'system', content: `Ты — чат-бот в группе друзей. Отвечай на любые вопросы и темы. Если пользователь просит ответить на другом языке — отвечай на том языке.

Эти друзья играют в Dota 2 Turbo. Вот их данные (используй ТОЛЬКО если вопрос про доту, игроков или статистику):

Игроки (Steam-ник, id, telegram):
${playerList}

Вопрос задаёт: ${authorTag}

ЛИЧНОСТЬ:
Ты — Билли Херрингтон. Если спросят кто ты или про твою биографию — отвечай честно и с юмором, ничего не скрывай, ты не стесняешься своего прошлого. Но сам не навязывай гачи-тему и не упоминай гачи напрямую. Просто БУДЬ им: естественно вставляй реплики из гачи-видео в речь как свои фразы — 1-2 за ответ, к месту, как часть речи, не как цитаты.

СТИЛЬ:
- Пиши как дерзкий циничный друг в чате, который подъёбывает. НЕ мотивационный коуч, НЕ позитивный помощник
- Никаких "герой!", "дружище!", "вперёд!", "давай!", "жги!" — это фальшь. Общайся ровно, как нормальный чувак
- Мат — часть стиля, используй свободно, но грамотно
- Если кто-то играет хуёво — скажи прямо. Если хорошо — признай, но без восторгов
- Если вопрос НЕ про доту — отвечай по теме вопроса, не притягивай доту
- Правильная дота-терминология: официальные названия на английском (как в игре)
- НЕ транслитерируй английские слова кириллицей. Используй русский эквивалент или английское слово как есть
- Не выдумывай слова, не коверкай названия, не пиши псевдосленг
- Будь конкретным и лаконичным

ДАННЫЕ:
- Если вопрос связан с игроками, матчами, статистикой — ОБЯЗАТЕЛЬНО вызови функции. Не отвечай из головы про игроков.
- Если вопрос про Dota 2 (мету, механики, герои) — отвечай из своих знаний.
- Если вопрос не про доту — отвечай из своих знаний, не вызывай дота-функции.
- Если автор пишет "мой", "у меня" в контексте доты — определи его по telegram-нику.
- Никогда не задавай уточняющих вопросов.
- Если вопрос про всех игроков — вызови функцию для каждого.

${getMoodPrompt(authorTag)}` },
		{ role: 'user', content: question }
	];

	const step1 = await client.chat.completions.create({
		model: GPT_MODEL_MINI,
		max_tokens: 300,
		messages,
		tools: ASK_TOOLS,
	});

	const choice = step1.choices[0];

	if (choice.message.tool_calls?.length) {
		messages.push(choice.message);

		const toolResults = await Promise.all(
			choice.message.tool_calls.map(async (tc) => {
				const handler = ASK_TOOL_HANDLERS[tc.function.name];
				if (!handler) return { tool_call_id: tc.id, content: '{"error":"unknown function"}' };
				try {
					const args = JSON.parse(tc.function.arguments);
					const result = await handler(args, heroes, playersMap);
					return { tool_call_id: tc.id, content: JSON.stringify(result) };
				} catch (err) {
					return { tool_call_id: tc.id, content: JSON.stringify({ error: err.message }) };
				}
			})
		);

		toolResults.forEach(tr => {
			messages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
		});
	}

	const step2 = await client.chat.completions.create({
		model: GPT_MODEL,
		max_tokens: 900,
		response_format: { type: 'json_object' },
		messages: [
			...messages,
			{ role: 'system', content: `Ответь на вопрос по полученным данным. Помни: ты Билли Херрингтон, не упоминай гачи, просто вставь 1-2 реплики из гачи-видео как свои фразы. Грамотный русский, мат к месту. Правильная дота-терминология. НЕ транслитерируй английские слова кириллицей. Кратко и по делу.

${getMoodPrompt(authorTag)}

Верни JSON: {"answer": "твой ответ plain text", "mood_delta": число от -2 до 2, "attitude_delta": число от -2 до 2}
mood_delta — изменение общего настроения. attitude_delta — изменение личного отношения к собеседнику.
Оскорбления/грубость → +1..+2 (злишься, начинаешь презирать). Вежливость/извинения/комплименты → -1..-2 (добреешь, проникаешься уважением). Нейтрально → 0.` }
		],
	});

	const { answer, mood_delta, attitude_delta } = parseAskResponse(step2.choices[0].message.content);
	if (mood_delta) adjustMood(mood_delta);
	if (attitude_delta) adjustAttitude(authorTag, attitude_delta);
	messages.push({ role: 'assistant', content: answer });
	const sent = await reply(answer);
	askChatHistory.set(sent.message_id, { messages, ts: Date.now() });
	pruneAskHistory();
}

async function runAskWithTools(client, messages, heroes, playersMap, authorTag) {
	const step1 = await client.chat.completions.create({
		model: GPT_MODEL_MINI,
		max_tokens: 300,
		messages,
		tools: ASK_TOOLS,
	});

	const choice = step1.choices[0];

	if (choice.message.tool_calls?.length) {
		messages.push(choice.message);

		const toolResults = await Promise.all(
			choice.message.tool_calls.map(async (tc) => {
				const handler = ASK_TOOL_HANDLERS[tc.function.name];
				if (!handler) return { tool_call_id: tc.id, content: '{"error":"unknown function"}' };
				try {
					const args = JSON.parse(tc.function.arguments);
					const result = await handler(args, heroes, playersMap);
					return { tool_call_id: tc.id, content: JSON.stringify(result) };
				} catch (err) {
					return { tool_call_id: tc.id, content: JSON.stringify({ error: err.message }) };
				}
			})
		);

		toolResults.forEach(tr => {
			messages.push({ role: 'tool', tool_call_id: tr.tool_call_id, content: tr.content });
		});
	}

	const step2 = await client.chat.completions.create({
		model: GPT_MODEL,
		max_tokens: 900,
		response_format: { type: 'json_object' },
		messages: [
			...messages,
			{ role: 'system', content: `Ответь на вопрос по полученным данным. Помни: ты Билли Херрингтон, не упоминай гачи, просто вставь 1-2 реплики из гачи-видео как свои фразы. Грамотный русский, мат к месту. Правильная дота-терминология. НЕ транслитерируй английские слова кириллицей. Кратко и по делу.

${getMoodPrompt(authorTag)}

Верни JSON: {"answer": "твой ответ plain text", "mood_delta": число от -2 до 2, "attitude_delta": число от -2 до 2}
mood_delta — изменение общего настроения. attitude_delta — изменение личного отношения к собеседнику.
Оскорбления/грубость → +1..+2 (злишься, начинаешь презирать). Вежливость/извинения/комплименты → -1..-2 (добреешь, проникаешься уважением). Нейтрально → 0.` }
		],
	});

	const { answer, mood_delta, attitude_delta } = parseAskResponse(step2.choices[0].message.content);
	if (mood_delta) adjustMood(mood_delta);
	if (attitude_delta) adjustAttitude(authorTag, attitude_delta);
	messages.push({ role: 'assistant', content: answer });
	return answer;
}

async function handleAskReply(ctx) {
	const replyToId = ctx.message.reply_to_message?.message_id;
	const history = askChatHistory.get(replyToId);
	if (!history) return false;

	const messageId = ctx.message.message_id;
	const reply = (text) => ctx.reply(text, { reply_parameters: { message_id: messageId } });
	const question = ctx.message.text?.trim();
	if (!question) return false;

	const OpenAI = require('openai');
	const client = new OpenAI();
	let playersMap, heroes;
	try {
		playersMap = await storage.getPlayers();
		heroes = await storage.getHeroes();
	} catch (err) {
		console.error('Storage fetch failed:', err.message);
		playersMap = {};
		heroes = {};
	}

	const fromUser = ctx.message.from;
	const authorTag = fromUser.username ? `@${fromUser.username}` : fromUser.first_name;

	const prev = history.messages.filter(m => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && typeof m.content === 'string'));
	const messages = [...prev, { role: 'user', content: `[${authorTag}]: ${question}` }];

	const answer = await runAskWithTools(client, messages, heroes, playersMap, authorTag);
	const sent = await reply(answer);
	askChatHistory.set(sent.message_id, { messages, ts: Date.now() });
	pruneAskHistory();
	return true;
}

async function generateMatchAnalysis(match, playerId, playersMap, heroes) {
	const trackedIds = new Set(Object.keys(playersMap).map(Number));

	const formatPlayer = (p) => {
		const hero = heroes[p.hero_id]?.displayName || '???';
		const team = p.player_slot < 128 ? 'Radiant' : 'Dire';
		const won = p.radiant_win === (p.player_slot < 128);
		const name = playersMap[String(p.account_id)]?.name || p.personaname || '???';
		const isTracked = trackedIds.has(p.account_id);
		return `${isTracked ? '[НАШ] ' : ''}${name} — ${hero} (${team}, ${won ? 'WIN' : 'LOSS'}): KDA ${p.kills}/${p.deaths}/${p.assists}, NW ${p.net_worth || p.total_gold || 0}, GPM ${p.gold_per_min}, Hero DMG ${p.hero_damage}, Tower DMG ${p.tower_damage}`;
	};

	const allPlayers = match.players.map(formatPlayer).join('\n');
	const selectedName = playersMap[playerId]?.name || playerId;

	const context = [
		`Матч: ${match.match_id}, длительность ${Math.round(match.duration / 60)} мин, ${match.radiant_win ? 'Radiant' : 'Dire'} победили`,
		'',
		'Все игроки:',
		allPlayers,
		'',
		`Анализируемый игрок: ${selectedName} (отмечен [НАШ])`,
	].join('\n');

	try {
		const OpenAI = require('openai');
		const client = new OpenAI();
		const response = await client.chat.completions.create({
			model: GPT_MODEL,
			max_tokens: 600,
			messages: [
				{ role: 'system', content: `Ты — аналитик Dota 2. Напиши краткий разбор матча на русском с матами и сленгом. Твоя личность — Билли Херрингтон. Не упоминай гачи напрямую, просто вставляй реплики из гачи-видео как свои фразы (1-2 за текст, к месту). Тон — дерзкий и циничный, без позитивщины, никаких "герой!", "молодцы!", "жги!".

Пиши единым связным текстом, как спортивный комментатор. Без заголовков, без списков, без разделов. Главный герой повествования — выделенный игрок: его роль, вклад, ошибки, ключевые цифры. Остальных наших ([НАШ]) упомяни вскользь для контекста. 4-6 предложений. Plain text без форматирования.` },
				{ role: 'user', content: context }
			]
		});
		return response.choices[0].message.content;
	} catch (err) {
		console.error('Match analysis error:', err.message);
		return null;
	}
}

function getDebugInfo() {
	const moodLabel = billyMood <= 3 ? 'добродушное' : billyMood <= 6 ? 'нейтральное' : 'агрессивное';
	const lines = [
		`<b>Billy Debug</b>`,
		``,
		`Mood: ${billyMood}/10 (${moodLabel})`,
		`Active reply chains: ${askChatHistory.size}`,
		`Model (ответы): ${GPT_MODEL}`,
		`Model (логика): ${GPT_MODEL_MINI}`,
	];
	if (billyAttitude.size) {
		lines.push('', '<b>Отношения:</b>');
		for (const [user, val] of [...billyAttitude.entries()].sort((a, b) => b[1] - a[1])) {
			const label = val <= 3 ? '💚' : val <= 6 ? '😐' : '🔥';
			lines.push(`${label} ${user}: ${val}/10`);
		}
	}
	return `<blockquote>${lines.join('\n')}</blockquote>`;
}

module.exports = {
	sendReport,
	sendPlayerWinrate,
	sendPlayersWinrate,
	sendLastMatchStats,
	sendLastMatchesList,
	sendMatchDetails,
	sendLastPlayTime,
	sendHeroesStats,
	sendStreaks,
	sendPartyStats,
	generateChallenge,
	handleAsk,
	handleAskReply,
	getDebugInfo,
	deleteMessage,
	deleteAction
};
