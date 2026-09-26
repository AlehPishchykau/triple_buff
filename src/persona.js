const path = require('path');

const configPath = process.env.BOT_CONFIG || path.join(__dirname, '..', 'bots', 'billy.js');
const persona = require(path.resolve(configPath));

if (typeof persona.triggerPattern === 'string') {
	persona.triggerRegex = new RegExp(persona.triggerPattern, 'i');
} else {
	persona.triggerRegex = persona.triggerPattern;
}

module.exports = persona;
