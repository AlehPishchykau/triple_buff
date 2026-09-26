module.exports = {
	apps: [
		{
			name: 'billy',
			script: 'src/index.js',
			env: {
				BOT_CONFIG: './bots/billy.js',
			},
		},
		// {
		// 	name: 'another_persona',
		// 	script: 'src/index.js',
		// 	env: {
		// 		BOT_CONFIG: './bots/another_persona.js',
		// 		TELEGRAM_BOT_TOKEN: '<token>',
		// 	},
		// },
	],
};
