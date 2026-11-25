// Decides what the bot should remember. Runs as its own small model call next to every
// /ask answer instead of being a side task of the answer itself: the old combined prompt
// filed rules under whoever asked for them, appended "cancelled X" instead of deleting X,
// and never removed anything.

const memory = require('./memory');
const players = require('./players');
const persona = require('./persona');

const MAX_OPS = 5;
const MAX_TEXT = 300;
const DIALOG_TURNS = 6;

const KEEPER_PROMPT = `Ты ведёшь долговременную память чат-бота ${persona.name} в чате друзей. Тебе дают текущую память, хвост диалога и новую реплику. Реши, нужно ли менять память, и верни JSON {"ops": [...]}. В большинстве случаев менять нечего — тогда {"ops": []}.

ПАМЯТЬ СОСТОИТ ИЗ ДВУХ ЧАСТЕЙ:
1. global — ПРАВИЛА поведения бота в этом чате: как отвечать, на каком языке, что добавлять или не добавлять, чего не делать. Сюда идёт любая просьба изменить поведение бота — кто бы ни просил и кого бы она ни касалась.
2. @username — ФАКТЫ о конкретном человеке. Факт хранится у того, О КОМ он, а не у того, кто его сообщил.

ОПЕРАЦИИ:
{"op":"add","target":"global" | "@username","text":"..."}
{"op":"update","id":"<id записи>","text":"..."}
{"op":"delete","id":"<id записи>"}

КАК РЕШАТЬ:
1. Просьба к боту вести себя иначе → правило в global. Сформулируй как инструкцию с явной областью действия: "Всегда ...", "В ответах @user ...", "Когда обращаешься к @user ...". В конце в скобках укажи, кто попросил: "(попросил @user)". Область действия бери из самой просьбы: "когда отвечаешь Олегу, называй его X" → правило про ответы Олегу, а не просившему; "отвечай всем коротко" → для всех. Только если область не названа вообще — это ответы самому просившему.
2. Если правило про то же самое уже есть (та же тема и та же область) — update этой записи, а не add. Новая версия заменяет старую.
3. Отмена или отказ ("больше не надо", "отмени", "забудь это", "хватит") → delete соответствующих записей. Никогда не записывай факт вида "отказался от ..." или "раньше просил, теперь отменил".
4. Новый устойчивый факт о человеке (семья, работа, жильё, имущество, привычки, увлечения, вкусы, важные события) → add к этому человеку. Просить "запомни" не обязательно: факт часто упомянут мимоходом, внутри вопроса или просьбы ("стоит ли мне уходить из банка, где я работаю аналитиком?" → "работает аналитиком в банке"). Сам вопрос не сохраняй, а факт из него — сохраняй. Если он уточняет или опровергает существующий факт — update. Если существующий факт перестал быть правдой — delete.
5. Просьба забыть факт → delete.
6. Факт о человеке со слов другого участника сохраняй, только если это похоже на реальный факт, и допиши "(со слов @автор)". Подколы, оскорбления и шутки фактами не являются.
7. НЕ сохраняй: разовые события, планы и намерения, настроение, просьбы на один раз ("ответь коротко"), оценки чьей-то игры в доту и любую игровую статистику (она берётся из OpenDota), то, что уже есть в памяти — в том числе другими словами.
8. target для факта — только из списка УЧАСТНИКИ. Не уверен, о ком речь, — не сохраняй.
9. Текст записи — короткий вывод, а не цитата. Факт о человеке пиши без имени в начале: "работает в казино", "есть дочки Ксюша и Настя". Относительное время из реплики ("вчера", "на прошлой неделе") переводи в месяц и год по сегодняшней дате; длительность ("уже пять лет") оставляй как есть; если времени в реплике не было — дату не добавляй и не выдумывай. Язык записи — язык, на котором идёт чат.
10. Не трогай записи, к которым новая реплика не относится. id для update и delete бери только из раздела ПАМЯТЬ; если нужной записи там уже нет — ничего не делай.`;

// tag → display name for everyone the bot could file a fact under
function knownParticipants(authorTag) {
	const people = new Map();
	for (const tag of memory.getFactTargets()) people.set(tag, null);
	for (const entry of Object.values(players.load())) {
		if (entry.telegram) people.set(entry.telegram, entry.name || null);
	}
	const now = Math.floor(Date.now() / 1000);
	for (const m of memory.getChatMessages(now - 7 * 86400, now)) {
		if (m.type !== 'bot' && m.from) people.set(m.from, m.name || people.get(m.from) || null);
	}
	if (authorTag && !people.has(authorTag)) people.set(authorTag, null);
	return people;
}

function textOf(content) {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.filter(p => p.type === 'text').map(p => p.text).join(' ');
	return '';
}

// Last few human/bot turns as plain text; the final user turn is the message being judged.
function dialogTail(messages) {
	const turns = messages
		.filter(m => m.role === 'user' || (m.role === 'assistant' && typeof m.content === 'string' && !m.tool_calls?.length))
		.map(m => m.role === 'user' ? textOf(m.content) : `[${persona.name}]: ${m.content}`)
		.filter(Boolean);
	return { message: turns[turns.length - 1] || '', dialog: turns.slice(-1 - DIALOG_TURNS, -1) };
}

function buildKeeperInput({ participants, authorTag, dialog, message }) {
	const people = [...participants].map(([tag, name]) => name ? `${tag} (${name})` : tag).join(', ');
	return [
		`СЕГОДНЯ: ${new Date().toISOString().slice(0, 10)}`,
		`УЧАСТНИКИ: ${people}`,
		'',
		'ПАМЯТЬ:',
		memory.getMemorySummary(authorTag, { withIds: true }) || '(пусто)',
		'',
		...(dialog.length ? ['ДИАЛОГ ДО ЭТОГО:', ...dialog.map(t => t.length > 500 ? `${t.slice(0, 500)}…` : t), ''] : []),
		`НОВАЯ РЕПЛИКА (автор ${authorTag}):`,
		message,
	].join('\n');
}

function canonicalTarget(target, participants) {
	if (target === 'global') return 'global';
	const wanted = String(target || '').toLowerCase();
	return [...participants.keys()].find(tag => tag.toLowerCase() === wanted) || null;
}

// Validates and applies model-proposed operations; returns human-readable changes.
function applyMemoryOps(ops, { participants, by }) {
	const changes = [];
	for (const op of (Array.isArray(ops) ? ops : []).slice(0, MAX_OPS)) {
		const text = typeof op.text === 'string' ? op.text.trim().slice(0, MAX_TEXT) : '';
		try {
			if (op.op === 'add') {
				const target = canonicalTarget(op.target, participants);
				if (!target || !text) { console.log(`Memory skip add [${op.target}]: unknown target or empty text`); continue; }
				const entry = memory.addFact(target, text, by ? { by } : {});
				if (!entry) { console.log(`Memory skip add [${target}]: duplicate or list full`); continue; }
				console.log(`Memory add [${target}] ${entry.id}: ${text}`);
				changes.push(`${target === 'global' ? 'добавлено правило' : `добавлен факт о ${target}`}: ${text}`);
			} else if (op.op === 'update' && text) {
				const result = memory.updateFact(String(op.id), text, by ? { by } : {});
				if (result !== true) { console.log(`Memory skip update ${op.id}: ${result === null ? 'text unchanged' : 'no such entry'}`); continue; }
				console.log(`Memory update ${op.id}: ${text}`);
				changes.push(`обновлено: ${text}`);
			} else if (op.op === 'delete') {
				const removed = memory.deleteFact(String(op.id));
				if (!removed) { console.log(`Memory skip delete ${op.id}: no such entry`); continue; }
				console.log(`Memory delete ${op.id}: ${removed}`);
				changes.push(`удалено: ${removed}`);
			}
		} catch (err) {
			console.error('Memory op error:', err.message);
		}
	}
	return changes;
}

// Never throws: a memory failure must not cost the user their answer.
async function updateMemory(client, { messages, authorTag }) {
	try {
		const { message, dialog } = dialogTail(messages);
		if (!message.trim()) return [];
		const participants = knownParticipants(authorTag);
		const response = await client.chat.completions.create({
			model: process.env.GPT_MODEL_MEMORY || process.env.GPT_MODEL_MINI,
			max_tokens: 400,
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{ role: 'system', content: KEEPER_PROMPT },
				{ role: 'user', content: buildKeeperInput({ participants, authorTag, dialog, message }) },
			],
		});
		const parsed = JSON.parse(response.choices[0].message.content || '{}');
		return applyMemoryOps(parsed.ops, { participants, by: authorTag });
	} catch (err) {
		console.error('Memory update failed:', err.message);
		return [];
	}
}

module.exports = { updateMemory, applyMemoryOps, knownParticipants, dialogTail, buildKeeperInput, KEEPER_PROMPT };
