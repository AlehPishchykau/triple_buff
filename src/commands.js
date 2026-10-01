const players = require('./players');
const persona = require('./persona');
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
} = require('./requests');
const { storage } = require('./storage');
const { secondsToTime, convertMiliseconds, isWin, escapeHTML, sanitizeTelegramHTML } = require('./utils');
const memory = require('./memory');
const { saveChatMessage } = memory;
const { parseMatchesData, getSummary, getMVP, getAwards, PERIOD_LABELS } = require('./matchParser');
const { adjustMood, adjustAttitude, getMoodPrompt, parseAskResponse, applyMemoryOps } = require('./mood');
const { ASK_TOOL_HANDLERS, getPersonaTools } = require('./askTools');
const { GPT_MODEL, GPT_MODEL_MINI, DATA_URL } = process.env;

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
	const playersList = Object.values(playersMap);

	const playersStats = response.map((stats, index) => {
		const turboStats = stats[period];

		if (!turboStats || turboStats.matchCount === 0) {
			return `
			<b>${playersList[index].name}</b>
			No turbo matches
		`;
		}

		return `
			<b>${playersList[index].name}</b>
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
	const playersMap = await storage.getPlayers();
	const stats = await fetchPlayerMatchesStats(playerId);
	const turboStats = stats[period];

	if (!playersMap[playerId]) {
		return;
	}

	if (!turboStats || turboStats.matchCount === 0) {
		const message = `
		<blockquote>
		<b>${playersMap[playerId].name}</b>
		No turbo matches found
		</blockquote>
	`;
		await ctx.replyWithHTML(message);
		return;
	}

	const periodString = period === 'allTime' ? 'All time' : 'Last month';

	const message = `
		<blockquote>
		<b>${playersMap[playerId].name}</b>

		${periodString} turbo matches: ${turboStats.matchCount}
		Winrate: ${(turboStats.winCount / turboStats.matchCount * 100).toFixed(1)}%
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
}

async function sendLastMatchStats(ctx, playerId) {
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const matches = await fetchLastMatches(playerId, 1);

	if (!matches.length || !playersMap[playerId]) {
		return;
	}

	const match = matches[0];
	const won = isWin(match);
	const hero = heroes[match.hero_id];

	const message = `
		<blockquote>
		<b>${playersMap[playerId].name}</b> <a href="https://www.opendota.com/matches/${match.match_id}">${won ? 'won' : 'lost'} last match on ${hero?.displayName || '???'}</a>
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
	const playersMap = await storage.getPlayers();
	const heroes = await storage.getHeroes();
	const match = await fetchMatchDetail(matchId);

	if (!match || !playersMap[playerId]) return;

	const p = match.players.find(pl => pl.account_id === Number(playerId));
	if (!p) return;

	const hero = heroes[p.hero_id];
	const won = p.radiant_win === (p.player_slot < 128);

	const message = `
		<blockquote>
		<b>${playersMap[playerId].name}</b> <a href="https://www.opendota.com/matches/${match.match_id}">${won ? 'won' : 'lost'} on ${hero?.displayName || '???'}</a>
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

	const analysis = await generateMatchAnalysis(match, playerId, playersMap, heroes);
	if (analysis) {
		await ctx.replyWithHTML(`<blockquote>${escapeHTML(analysis)}</blockquote>`);
	}
}

async function sendLastPlayTime(ctx) {
	const playersMap = await storage.getPlayers();
	const requests = Object.keys(playersMap).map(id => fetchLastMatchData(id));
	const response = await Promise.all(requests);
	const playersList = Object.values(playersMap);

	const timeStats = response.map((match, index) => {
		if (!match) {
			return `${playersList[index].name}: no matches found`;
		}
		const endTime = (match.start_time + match.duration) * 1000;
		const time = Date.now() - endTime;
		return `${playersList[index].name}: ${convertMiliseconds(time)}`;
	});

	const message = `
		<blockquote>
		<b>Time without Dota 2</b>
		\n${timeStats.join('\n')}
		</blockquote>
	`;

	await ctx.replyWithHTML(message);
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

	const systemPrompt = `${persona.prompts.identity}

Ты генерируешь челленджи для друзей, играющих в Dota 2 Turbo. Челлендж должен быть конкретным.

ПРАВИЛА:
- Один конкретный челлендж на 1 игру. Не "постарайтесь", а чёткое условие.
- Челлендж должен быть проверяем по результату матча: конкретный герой, конкретный итем, конкретная цифра (kills/deaths/GPM/tower dmg).
- Используй статистику: если у игрока 70% WR на герое — заставь играть на худшем. Если фармер — запрети покупать BKB. Если фидер — челлендж на 0 смертей.
${persona.prompts.challengeStyle}`;

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

	const challenge = sanitizeTelegramHTML(response.choices[0].message.content);
	const title = isRandom ? '🎲 Челлендж' : `🎲 Челлендж для ${targetName}`;
	await ctx.replyWithHTML(`<blockquote><b>${title}</b>\n\n${challenge}</blockquote>`);
}

async function generateAIReport(data, playersMap, heroes, period) {
	const playerSections = Object.entries(data.players).map(([id, stats]) => {
		const name = playersMap[id]?.name || 'Unknown';
		const total = stats.wins + stats.loses;
		const wr = ((stats.wins / total) * 100).toFixed(0);
		const kdaAvg = (stats.kdas.reduce((a, b) => a + b, 0) / stats.kdas.length).toFixed(1);

		const matchLines = stats.matches.map(m => {
			const hero = heroes[m.heroId]?.displayName || '???';
			const result = m.won ? 'WIN' : 'LOSS';
			const mins = Math.round(m.duration / 60);
			const parts = [
				`${hero} (${result}, ${mins} мин)`,
				`KDA ${m.kills}/${m.deaths}/${m.assists}`,
				`GPM ${m.gpm}`,
				`Hero DMG ${m.heroDamage}`,
				`Tower DMG ${m.towerDamage}`,
			];
			if (m.heroHealing > 500) parts.push(`Healing ${m.heroHealing}`);
			parts.push(`LH ${m.lastHits}`);
			return `  - ${parts.join(', ')}`;
		});

		return [`${name}: ${stats.wins}W-${stats.loses}L (${wr}%), Avg KDA ${kdaAvg}`, ...matchLines].join('\n');
	});

	if (!playerSections.length) return null;

	const wins = Object.keys(data.summary.wins).length;
	const loses = Object.keys(data.summary.loses).length;
	const mvp = getMVP(data, playersMap);
	const periodLabel = PERIOD_LABELS[period] || PERIOD_LABELS.yesterday;
	const playerCount = Object.keys(data.players).length;
	const matchCount = wins + loses;

	const factsText = memory.getMemorySummary();

	const context = [
		`Период: ${periodLabel}`,
		`Всего матчей: ${matchCount}, общий счёт: ${wins}W-${loses}L`,
		`Играло: ${playerCount} чел.`,
		`Самый длинный матч: ${secondsToTime(data.summary.longestMatchDuration)}`,
		`Самый короткий матч: ${secondsToTime(data.summary.shortestMatchDuration)}`,
		'',
		'Детали по игрокам:',
		...playerSections,
		'',
		`MVP: ${mvp.name} (${mvp.wins}W-${mvp.loses}L, KDA ${mvp.kdaAvg.toFixed(1)}, NW ${mvp.nwAvg.toFixed(0)})`,
		...(factsText ? ['', 'Факты об игроках (используй к месту, если уместно):', factsText] : []),
	].join('\n');

	const lengthGuide = matchCount <= 3 ? '80-120 слов' : matchCount <= 8 ? '150-250 слов' : '250-350 слов';

	try {
		const OpenAI = require('openai');
		const client = new OpenAI();
		const response = await client.chat.completions.create({
			model: GPT_MODEL,
			max_tokens: 1200,
			messages: [
				{ role: 'system', content: `${persona.prompts.identity}

Пиши отчёт по матчам Dota 2 Turbo для чата друзей. Пиши на русском.

ЖЁСТКИЕ ПРАВИЛА:
- Пиши ТОЛЬКО по данным ниже. Не придумывай имена, события, цифры, которых нет в данных.
- Каждое имя в тексте должно быть из списка игроков. Никаких выдуманных прозвищ.
- Если факт не следует из данных — не пиши его.

ФАКТЫ ОБ ИГРОКАХ:
- В данных могут быть факты о привычках, любимых героях, особенностях игроков. Если факт уместен — вплети его в комментарий для персонализации. Не пересказывай все факты, используй только те, которые связаны со статистикой дня.

АНАЛИЗ ПО РОЛЯМ:
- У тебя есть детальные данные по каждому матчу: герой, KDA, дамаг, хил, LH, tower dmg. ИСПОЛЬЗУЙ ИХ.
- Определяй роль по герою и метрикам: низкий GPM + LH < 100 + healing = суппорт, высокий GPM + LH > 200 = кор.
- Суппорт с 8 смертями и 20+ ассистами — это НЕ фидер, это рабочая лошадка. Оценивай в контексте роли.
- Керри с высоким NW/GPM, но низким hero damage — бесполезный АФК-фармер, подъеби за это.
- Мидер с hero damage ниже суппорта — позор. Подмечай такие контрасты.
- Если кто-то играл несколько матчей на разных героях — отметь разницу в перфомансе.
- Дай каждому игроку индивидуальную оценку с привязкой к конкретным героям.
- ОБЯЗАТЕЛЬНО найди что-то хорошее в игре каждого — даже если он слил. Высокие ассисты, хороший tower damage, healing, участие в килах. Подай это дерзко, без восторгов, но признай заслугу. Даже худшему игроку дня найди за что зацепиться.

СТИЛЬ:
${persona.prompts.reportStyle}

ФОРМАТ:
- Сначала общая картина дня (2-3 предложения), потом по каждому игроку отдельный абзац с разбором.
- Форматирование: Telegram HTML (<b>, <i>). Имя игрока выделяй жирным. Не используй markdown.
- Длина: ${lengthGuide}.
${persona.prompts.reportBonus}` },
				{ role: 'user', content: context }
			]
		});
		const text = sanitizeTelegramHTML(response.choices[0].message.content);
		return `<blockquote><b>${periodLabel}</b>\n\n${text}</blockquote>`;
	} catch (err) {
		console.error('AI report generation error:', err.message);
		return null;
	}
}

const askChatHistory = new Map();
const ASK_HISTORY_TTL = 8 * 60 * 60 * 1000;
const ASK_HISTORY_MAX = 200;

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

function rememberReplyChain(messageId, messages) {
	askChatHistory.set(messageId, { messages, ts: Date.now() });
	pruneAskHistory();
}

async function downloadPhoto(ctx) {
	const photos = ctx.message.photo;
	if (!photos?.length) return null;
	const best = photos[photos.length - 1];
	const fileLink = await ctx.telegram.getFileLink(best.file_id);
	const res = await fetch(fileLink.href);
	const buffer = Buffer.from(await res.arrayBuffer());
	const filename = `${Date.now()}_${best.file_id.slice(-8)}.jpg`;
	memory.savePhoto(filename, buffer);
	const publicUrl = `${DATA_URL}/photos/${filename}`;
	console.log(`Photo saved: ${filename} → ${publicUrl}`);
	return publicUrl;
}

const RESPONSE_PROMPT = `Верни JSON: {"answer": "...", "mood_delta": -5..5, "attitude_delta": -5..5, "memory_ops": [...]}
mood_delta/attitude_delta — шкала 1-100, дельты от -5 до +5.
Обычный разговор, вопросы → -1, 0, или +1 (мелкие колебания, это нормально).
Подколы, лёгкая грубость, шутки на грани → +1..+2.
Вежливость, благодарность, комплименты → -1..-2.
Явные оскорбления, агрессия → +3..+5.
Извинения, искреннее раскаяние → -3..-5.
ВАЖНО: не ставь +3..+5 на обычные подколы или вопросы. Высокие дельты — только за явную агрессию или доброту.
memory_ops — массив операций с памятью (может быть пустым []):
  {"action":"save","target":"global"|"@username","fact":"компактный факт"}
  {"action":"replace","target":"...","index":N,"fact":"обновлённый факт"}
  {"action":"delete","target":"...","index":N}
ПРАВИЛА ЗАПОМИНАНИЯ:
- Сохраняй ВЫВОДЫ о человеке, а не цитаты из чата. Не "сказал что купил квартиру", а "владеет новой квартирой". Не "обсуждал мотоцикл", а "ездит на мотоцикле".
- Сохраняй только устойчивые факты: профессия, хобби, имущество, привычки, предпочтения, навыки, жизненные события (переезд, свадьба, работа). Не сохраняй планы на вечер, настроение, мимолётные реплики.
- Обновляй существующие факты вместо дублирования. Индексы — из раздела ПАМЯТЬ в контексте.
- Не жди команды "запомни" — если из сообщения можно сделать вывод о человеке, сохрани.`;

async function runAskWithTools(client, messages, heroes, playersMap, authorTag) {
	const step1 = await client.chat.completions.create({
		model: GPT_MODEL_MINI,
		max_tokens: 300,
		messages,
		tools: getPersonaTools(),
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
			{ role: 'system', content: `Ответь на вопрос по полученным данным. Помни: ${persona.prompts.styleShort}

${getMoodPrompt(authorTag)}

${RESPONSE_PROMPT}` }
		],
	});

	const { answer, mood_delta, attitude_delta, memory_ops } = parseAskResponse(step2.choices[0].message.content);
	if (mood_delta) adjustMood(mood_delta);
	if (attitude_delta) adjustAttitude(authorTag, attitude_delta);
	if (memory_ops.length) applyMemoryOps(memory_ops);
	messages.push({ role: 'assistant', content: answer });
	return answer;
}

async function handleAsk(ctx) {
	const messageId = ctx.message.message_id;
	const reply = (text) => ctx.reply(text, { reply_parameters: { message_id: messageId } });
	const rawText = (ctx.message.text || ctx.message.caption || '').replace(new RegExp('^/(ask|' + persona.command + ')\\s*'), '').trim();
	const photoUrl = await downloadPhoto(ctx);
	if (!rawText && !photoUrl) {
		await reply(`Напиши вопрос после команды, например:\n/${persona.command} кто больше всех фидит на pudge?`);
		return;
	}
	const question = rawText || 'Что на этом фото?';

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
			const telegramMap = players.getTelegramMap();
		const tg = telegramMap[Number(id)] || '';
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
${persona.prompts.identity}

СТИЛЬ:
${persona.prompts.style}

ДАННЫЕ:
- Если вопрос связан с игроками, матчами, статистикой — ОБЯЗАТЕЛЬНО вызови функции. Не отвечай из головы про игроков.
- Если вопрос про Dota 2 (мету, механики, герои) — отвечай из своих знаний.
- Если вопрос не про доту — отвечай из своих знаний, не вызывай дота-функции.
- Если автор пишет "мой", "у меня" в контексте доты — определи его по telegram-нику.
- Никогда не задавай уточняющих вопросов.
- Если вопрос про всех игроков — вызови функцию для каждого.

ИСТОРИЯ ЧАТА:
- Если вопрос про переписку, обсуждения, "что говорили", "о чём общались" — ОБЯЗАТЕЛЬНО вызови get_chat_history.
- Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}. Для "сегодня" передавай date с этой датой, для "вчера" — вчерашнюю. НЕ используй hours_ago для конкретных дней.
- Если спрашивают уточнение по переписке ("а что именно он сказал?", "а кто это написал?") — вызови get_chat_history снова, не отвечай по памяти.
- Отвечай ТОЛЬКО по данным из get_chat_history. Если сообщений нет — скажи что данных нет, не выдумывай.

${getMoodPrompt(authorTag)}` },
		{ role: 'user', content: photoUrl
			? [
				{ type: 'text', text: `[${authorTag}]: ${question}` },
				{ type: 'image_url', image_url: { url: photoUrl } }
			]
			: `[${authorTag}]: ${question}` }
	];

	const answer = await runAskWithTools(client, messages, heroes, playersMap, authorTag);
	const displayAnswer = ctx.voiceTranscript
		? `«${ctx.voiceTranscript}»\n\n${answer}`
		: answer;
	const sent = await reply(displayAnswer);
	saveChatMessage({ from: persona.command, name: persona.name, text: answer, ts: Math.floor(Date.now() / 1000), type: 'bot' });
	askChatHistory.set(sent.message_id, { messages, ts: Date.now() });
	pruneAskHistory();
}

async function handleAskReply(ctx) {
	const replyToId = ctx.message.reply_to_message?.message_id;
	const history = askChatHistory.get(replyToId);
	if (!history) return false;

	const messageId = ctx.message.message_id;
	const reply = (text) => ctx.reply(text, { reply_parameters: { message_id: messageId } });
	const question = (ctx.message.text || ctx.message.caption || '').trim();
	const photoUrl = await downloadPhoto(ctx);
	if (!question && !photoUrl) return false;

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
	const messages = [
		...prev,
		{ role: 'system', content: `Сейчас с тобой говорит: ${authorTag}. Отвечай именно ему. Mood/attitude применяй к нему. Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}. Если вопрос про переписку или уточнение по ней — вызови get_chat_history, не отвечай по памяти.\n${getMoodPrompt(authorTag)}` },
		{ role: 'user', content: photoUrl
			? [
				{ type: 'text', text: `[${authorTag}]: ${question || 'Что на этом фото?'}` },
				{ type: 'image_url', image_url: { url: photoUrl } }
			]
			: `[${authorTag}]: ${question}` }
	];

	const answer = await runAskWithTools(client, messages, heroes, playersMap, authorTag);
	const sent = await reply(answer);
	saveChatMessage({ from: persona.command, name: persona.name, text: answer, ts: Math.floor(Date.now() / 1000), type: 'bot' });
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
				{ role: 'system', content: `${persona.prompts.identity}

Ты — аналитик Dota 2. Напиши краткий разбор матча на русском. ${persona.prompts.analysisStyle}

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
	const debug = memory.getDebugData();
	const moodLabel = debug.mood <= 30 ? 'добродушное' : debug.mood <= 65 ? 'нейтральное' : 'агрессивное';
	const lines = [
		`<b>${persona.name} Debug</b>`,
		``,
		`Mood: ${debug.mood}/100 (${moodLabel})`,
		`Active reply chains: ${askChatHistory.size}`,
		`Model (ответы): ${GPT_MODEL}`,
		`Model (логика): ${GPT_MODEL_MINI}`,
	];
	const attitudeEntries = Object.entries(debug.attitudes);
	if (attitudeEntries.length) {
		lines.push('', '<b>Отношения:</b>');
		for (const [user, val] of attitudeEntries.sort((a, b) => b[1] - a[1])) {
			const label = val <= 30 ? '💚' : val <= 65 ? '😐' : '🔥';
			lines.push(`${label} ${user.replace('@', '')}: ${val}/100`);
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
	rememberReplyChain,
	getDebugInfo,
	deleteMessage,
	deleteAction,
};
