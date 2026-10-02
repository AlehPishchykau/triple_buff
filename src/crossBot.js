const persona = require('./persona');
const { GPT_MODEL } = process.env;

const crossBotState = {};

function resetChain(chatId) {
	if (crossBotState[chatId]) crossBotState[chatId].chainCount = 0;
}

function canReplyToBot(chatId) {
	const config = persona.crossBot;
	if (!config) return false;
	if (!crossBotState[chatId]) crossBotState[chatId] = { chainCount: 0, lastReplyTs: 0, lastRandomTs: 0 };
	const state = crossBotState[chatId];
	if (state.chainCount >= (config.maxChain || 2)) return false;
	if (Date.now() - state.lastReplyTs < (config.cooldownMs || 120000)) return false;
	if (Math.random() > (config.replyChance || 0.3)) return false;
	return true;
}

function trackBotMessage(chatId) {
	if (!crossBotState[chatId]) crossBotState[chatId] = { chainCount: 0, lastReplyTs: 0, lastRandomTs: 0 };
	crossBotState[chatId].chainCount++;
}

function markBotReply(chatId) {
	if (!crossBotState[chatId]) crossBotState[chatId] = { chainCount: 0, lastReplyTs: 0, lastRandomTs: 0 };
	crossBotState[chatId].lastReplyTs = Date.now();
}

function canRandomInterject(chatId) {
	const config = persona.crossBot;
	if (!config?.randomChance) return false;
	if (Math.random() >= config.randomChance) return false;
	if (!crossBotState[chatId]) crossBotState[chatId] = { chainCount: 0, lastReplyTs: 0, lastRandomTs: 0 };
	const cooldown = config.randomCooldownMs || 600000;
	return Date.now() - (crossBotState[chatId].lastRandomTs || 0) > cooldown;
}

function markRandomInterjection(chatId) {
	if (!crossBotState[chatId]) crossBotState[chatId] = { chainCount: 0, lastReplyTs: 0, lastRandomTs: 0 };
	crossBotState[chatId].lastRandomTs = Date.now();
}

async function handleCrossBotReply(botText, botName) {
	const OpenAI = require('openai');
	const client = new OpenAI();

	const messages = [
		{ role: 'system', content: `${persona.prompts.identity}

${persona.prompts.style}

В групповом чате другая личность (${botName}) написала сообщение. Если тебе как ${persona.name} есть что добавить — реакция, несогласие, дополнение, свой анализ, подъёб — напиши ответ. Не натягивай: если тема тебя не касается или добавить нечего — ответь ровно одним словом: SKIP` },
		{ role: 'user', content: `[${botName}]: ${botText}` }
	];
	return complete(client, messages);
}

async function complete(client, messages) {
	const response = await client.chat.completions.create({ model: GPT_MODEL, max_tokens: 600, messages });
	const answer = response.choices[0].message.content?.trim();
	if (!answer || answer.toUpperCase().startsWith('SKIP')) return null;
	return { answer, messages: [...messages, { role: 'assistant', content: answer }] };
}

async function handleRandomInterjection(recentMessages) {
	const OpenAI = require('openai');
	const client = new OpenAI();

	const format = m => `[${m.name}]: ${m.text}`;
	const earlier = recentMessages.slice(0, -1).map(format).join('\n');
	const last = format(recentMessages[recentMessages.length - 1]);
	const chatContext = `Предыдущая переписка:\n${earlier}\n\nПоследнее сообщение (на него ты отвечаешь реплаем):\n${last}`;

	return complete(client, [
		{ role: 'system', content: `${persona.prompts.identity}

${persona.prompts.style}

Ты сидишь в групповом чате и наблюдаешь за перепиской. Ниже переписка за последний час и отдельно последнее сообщение. Сначала пойми, о чём идёт разговор в целом: кто что обсуждает, к чему относится последнее сообщение. Твоя реплика должна учитывать контекст всей переписки, а не только последней фразы. Если тебе как ${persona.name} есть что вставить — едкий комментарий, неожиданная мысль, реакция — напиши. Это должно быть действительно к месту. Не натягивай: если нечего сказать — ответь ровно одним словом: SKIP` },
		{ role: 'user', content: chatContext }
	]);
}

module.exports = {
	resetChain,
	canReplyToBot,
	trackBotMessage,
	markBotReply,
	canRandomInterject,
	markRandomInterjection,
	handleCrossBotReply,
	handleRandomInterjection,
};
