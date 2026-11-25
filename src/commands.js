const players = require('./players');
const persona = require('./persona');
const { fetchMatchesData, fetchPlayersData } = require('./requests');
const { storage } = require('./storage');
const { secondsToTime, sanitizeTelegramHTML } = require('./utils');
const memory = require('./memory');
const { saveChatMessage } = memory;
const { parseMatchesData, getSummary, getMVP, getAwards, PERIOD_LABELS } = require('./matchParser');
const { adjustMood, adjustAttitude, getMoodPrompt, parseAskResponse, applyMemoryOps } = require('./mood');
const { ASK_TOOL_HANDLERS, getPersonaTools, isDotaTool } = require('./askTools');
const { buildDotaContext, DOTA_ANALYSIS_RULES, DOTA_FOLLOWUP_HINT, ROSTER_MARKER } = require('./askPrompts');
const { compactHistory, toolsWithData } = require('./askHistory');
const { GPT_MODEL, DATA_URL } = process.env;
// Model that plans the tool calls. The main model chains lookups (find the match → open
// it) noticeably better than the mini one; set GPT_MODEL_TOOLS to override.
const TOOLS_MODEL = process.env.GPT_MODEL_TOOLS || GPT_MODEL;

async function sendReport(ctx, period = 'yesterday') {
	const matchesData = await fetchMatchesData(period);
	const playersData = await fetchPlayersData();
	const heroes = await storage.getHeroes();

	const parsedMatchesData = parseMatchesData(matchesData);
	if (!Object.keys(parsedMatchesData.players).length) {
		if (period !== 'yesterday') await ctx.replyWithHTML('<blockquote>За этот период матчей не было</blockquote>');
		return;
	}

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

async function deleteMessage(ctx) {
	try {
		await ctx.deleteMessage(ctx.update.message.messageId);
	} catch(error) {
		console.log(error);
	}
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

const MAX_TOOL_ROUNDS = 4;

async function executeToolCall(tc, heroes, playersMap) {
	const handler = ASK_TOOL_HANDLERS[tc.function.name];
	if (!handler) return { tool_call_id: tc.id, content: '{"error":"unknown function"}' };
	try {
		const args = JSON.parse(tc.function.arguments || '{}');
		const result = await handler(args, heroes, playersMap);
		return { tool_call_id: tc.id, content: JSON.stringify(result) };
	} catch (err) {
		console.error(`Tool ${tc.function.name} failed: ${err.message}`);
		return { tool_call_id: tc.id, content: JSON.stringify({ error: err.message }) };
	}
}

// Lets the model gather context over several rounds (find a match → open it → compare
// with the player's profile) before the final answer is written.
async function gatherToolData(client, messages, heroes, playersMap) {
	const tools = getPersonaTools();
	if (!tools.length) return;
	for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
		const step = await client.chat.completions.create({
			model: TOOLS_MODEL,
			max_tokens: 500,
			messages,
			tools,
		});
		const message = step.choices[0].message;
		if (!message.tool_calls?.length) return;

		console.log(`[ask] tools round ${round}: ${message.tool_calls.map(tc => `${tc.function.name}(${tc.function.arguments})`).join(', ')}`);
		messages.push(message);
		const results = await Promise.all(message.tool_calls.map(tc => executeToolCall(tc, heroes, playersMap)));
		results.forEach(r => messages.push({ role: 'tool', tool_call_id: r.tool_call_id, content: r.content }));
	}
}

async function runAskWithTools(client, messages, heroes, playersMap, authorTag) {
	await gatherToolData(client, messages, heroes, playersMap);
	const hasDotaData = toolsWithData(messages).some(isDotaTool);

	const step2 = await client.chat.completions.create({
		model: GPT_MODEL,
		max_tokens: 1100,
		// Data-backed answers get a lower temperature so numbers and items stay attached to the right player.
		...(hasDotaData ? { temperature: 0.7 } : {}),
		response_format: { type: 'json_object' },
		messages: [
			...messages,
			{ role: 'system', content: `Ответь на вопрос по полученным данным. Помни: ${persona.prompts.styleShort}
${hasDotaData ? `\n${DOTA_ANALYSIS_RULES}\n` : ''}
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

function hasDotaTools() {
	return getPersonaTools().some(t => isDotaTool(t.function.name));
}

function dotaContextFor(playersMap, authorTag) {
	if (!hasDotaTools() || !Object.keys(playersMap).length) return '';
	return buildDotaContext({
		playersMap,
		telegramMap: players.getTelegramMap(),
		authorTag,
		today: new Date().toISOString().slice(0, 10),
		challengeStyle: persona.prompts.challengeStyle,
	});
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

	const fromUser = ctx.message.from;
	const authorTag = fromUser.username ? `@${fromUser.username}` : fromUser.first_name;
	const dotaContext = dotaContextFor(playersMap, authorTag);

	const messages = [
		{ role: 'system', content: `Ты — ${persona.name}, чат-бот в группе друзей. Отвечай на любые вопросы и темы. По умолчанию отвечай на русском; если пользователь просит другой язык — отвечай на нём.

Вопрос задаёт: ${authorTag}. Ты и автор вопроса — разные люди, не говори о его играх и делах от первого лица.

ЛИЧНОСТЬ:
${persona.prompts.identity}

СТИЛЬ:
${persona.prompts.style}
${dotaContext ? `\n${dotaContext}\n` : ''}
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

	let t0 = Date.now();
	const answer = await runAskWithTools(client, messages, heroes, playersMap, authorTag);
	console.log(`[timing] ask openai: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	const displayAnswer = ctx.voiceTranscript
		? `«${ctx.voiceTranscript}»\n\n${answer}`
		: answer;
	t0 = Date.now();
	const sent = await reply(displayAnswer);
	console.log(`[timing] ask reply sendMessage: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	saveChatMessage({ from: persona.command, name: persona.name, text: answer, ts: Math.floor(Date.now() / 1000), type: 'bot' });
	rememberReplyChain(sent.message_id, messages);
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

	const prev = compactHistory(history.messages);
	// Chains started by a cross-bot reply have no roster yet; ordinary chains already carry it.
	const hasRoster = prev.some(m => m.role === 'system' && typeof m.content === 'string' && m.content.includes(ROSTER_MARKER));
	const dotaContext = hasRoster ? '' : dotaContextFor(playersMap, authorTag);
	const dotaHint = hasDotaTools() ? ` ${DOTA_FOLLOWUP_HINT}` : '';
	const messages = [
		...prev,
		{ role: 'system', content: `Сейчас с тобой говорит: ${authorTag}. Отвечай именно ему. Mood/attitude применяй к нему. Сегодняшняя дата: ${new Date().toISOString().slice(0, 10)}. Если вопрос про переписку или уточнение по ней — вызови get_chat_history, не отвечай по памяти.${dotaHint}${dotaContext ? `\n\n${dotaContext}` : ''}\n${getMoodPrompt(authorTag)}` },
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
	rememberReplyChain(sent.message_id, messages);
	return true;
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
		`Model (инструменты): ${TOOLS_MODEL}`,
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
	handleAsk,
	handleAskReply,
	rememberReplyChain,
	getDebugInfo,
	deleteMessage,
};
