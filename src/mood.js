const memory = require('./memory');
const chatScope = require('./chatScope');
const persona = require('./persona');

const MOOD_BASELINE = 30;
const DECAY_INTERVAL = 60 * 60 * 1000;

function decayValue(current) {
	if (current === MOOD_BASELINE) return current;
	const step = Math.min(5, Math.abs(current - MOOD_BASELINE));
	return current + (current > MOOD_BASELINE ? -step : step);
}

function decayToBaseline() {
	const mood = memory.getMood();
	if (mood !== MOOD_BASELINE) {
		const next = memory.setMood(decayValue(mood));
		console.log(`Mood decay: ${mood} → ${next}`);
	}
	const debug = memory.getDebugData();
	for (const [user, val] of Object.entries(debug.attitudes)) {
		if (val !== MOOD_BASELINE) {
			const next = memory.setAttitude(user, decayValue(val));
			console.log(`Attitude decay [${user}]: ${val} → ${next}`);
		}
	}
}

function startDecayTimer() {
	setInterval(() => {
		for (const chatId of chatScope.listChatIds()) {
			chatScope.run(chatId, decayToBaseline);
		}
	}, DECAY_INTERVAL);
}

function adjustMood(delta) {
	const prev = memory.getMood();
	const next = memory.setMood(prev + delta);
	console.log(`Mood: ${prev} → ${next} (delta: ${delta > 0 ? '+' : ''}${delta})`);
}

function adjustAttitude(user, delta) {
	const prev = memory.getAttitude(user);
	const next = memory.setAttitude(user, prev + delta);
	console.log(`Attitude [${user}]: ${prev} → ${next} (delta: ${delta > 0 ? '+' : ''}${delta})`);
}

function clampDelta(n) {
	return Math.max(-5, Math.min(5, Math.round(Number(n) || 0)));
}

function parseAskResponse(raw) {
	try {
		const parsed = JSON.parse(raw);
		return {
			answer: parsed.answer || raw,
			mood_delta: clampDelta(parsed.mood_delta),
			attitude_delta: clampDelta(parsed.attitude_delta),
			memory_ops: Array.isArray(parsed.memory_ops) ? parsed.memory_ops : [],
		};
	} catch {
		return { answer: raw, mood_delta: 0, attitude_delta: 0, memory_ops: [] };
	}
}

function applyMemoryOps(ops) {
	for (const op of ops) {
		try {
			if (op.action === 'save') {
				memory.addFact(op.target, op.fact);
				console.log(`Memory save [${op.target}]: ${op.fact}`);
			} else if (op.action === 'replace') {
				memory.replaceFact(op.target, op.index, op.fact);
				console.log(`Memory replace [${op.target}][${op.index}]: ${op.fact}`);
			} else if (op.action === 'delete') {
				const removed = memory.deleteFact(op.target, op.index);
				console.log(`Memory delete [${op.target}][${op.index}]: ${removed}`);
			}
		} catch (err) {
			console.error(`Memory op error:`, err.message);
		}
	}
}

function getMoodPrompt(authorTag) {
	const mood = memory.getMood();
	const attitude = memory.getAttitude(authorTag);
	const effective = Math.round((mood + attitude * 2) / 3);

	let moodLine;
	if (mood <= 30) moodLine = `Общее настроение: ${mood}/100 — ты в хорошем расположении духа.`;
	else if (mood <= 65) moodLine = `Общее настроение: ${mood}/100 — стандартный режим.`;
	else moodLine = `Общее настроение: ${mood}/100 — ты на взводе, раздражён.`;

	let attitudeLine;
	if (attitude <= 30) attitudeLine = `Отношение к ${authorTag}: ${attitude}/100 — тебе нравится этот человек, он заслужил уважение.`;
	else if (attitude <= 65) attitudeLine = `Отношение к ${authorTag}: ${attitude}/100 — нейтральное, обычный чувак.`;
	else attitudeLine = `Отношение к ${authorTag}: ${attitude}/100 — этот человек тебя бесит, ты его не уважаешь.`;

	let styleLine;
	if (effective <= 30) styleLine = `Итог: ${persona.prompts.moodLow}`;
	else if (effective <= 65) styleLine = `Итог: ${persona.prompts.moodMid}`;
	else styleLine = `Итог: ${persona.prompts.moodHigh}`;

	const memorySummary = memory.getMemorySummary(authorTag);
	const memoryLine = memorySummary ? `\nПАМЯТЬ:\n${memorySummary}` : '';

	return `${moodLine}\n${attitudeLine}\n${styleLine}${memoryLine}`;
}

module.exports = {
	MOOD_BASELINE,
	decayValue,
	decayToBaseline,
	startDecayTimer,
	adjustMood,
	adjustAttitude,
	clampDelta,
	parseAskResponse,
	applyMemoryOps,
	getMoodPrompt,
};
