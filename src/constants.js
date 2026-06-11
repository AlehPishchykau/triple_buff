const PLAYERS_IDS = [
	157339325, // Tango
	128559468, // Midas
	162211548, // Vodorod
	56193772,  // Mechasm
	128920198, // Desolator
	306666325, // Mango
	129638532, // Blink
];

const TELEGRAM_USERNAMES = [
	'@midsummer314',  // Tango
	'@Myosis',        // Midas
	'@waldemarks',    // Vodorod
	'@sashashukala',  // Mechasm
	'@privet_aga',    // Desolator
	'@conden5at',     // Mango
	'@a_volynets',    // Blink
];

const PLAYER_TELEGRAM_MAP = {
	157339325: '@midsummer314',  // Tango
	128559468: '@Myosis',        // Midas
	162211548: '@waldemarks',    // Vodorod
	56193772:  '@sashashukala',  // Mechasm
	128920198: '@privet_aga',    // Desolator
	306666325: '@conden5at',     // Mango
	129638532: '@a_volynets',    // Blink
};

const OPENDOTA_API_URL = 'https://api.opendota.com/api';

module.exports = {
	PLAYERS_IDS,
	TELEGRAM_USERNAMES,
	PLAYER_TELEGRAM_MAP,
	OPENDOTA_API_URL
};
