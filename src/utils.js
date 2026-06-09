require('dotenv').config();

const { STRATZ_GRAPHQL_URL } = require('./constants');
const { STRATZ_TOKEN } = process.env;

async function graphqlRequest(query, variables = {}, retries = 2) {
	const response = await fetch(STRATZ_GRAPHQL_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${STRATZ_TOKEN}`,
			'Content-Type': 'application/json',
			'User-Agent': 'STRATZ_API'
		},
		body: JSON.stringify({ query, variables })
	});

	if (response.status === 429 && retries > 0) {
		const delay = parseInt(response.headers.get('retry-after') || '3', 10) * 1000;
		await new Promise(r => setTimeout(r, delay));
		return graphqlRequest(query, variables, retries - 1);
	}

	if (!response.ok) {
		throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
	}

	const result = await response.json();

	if (result.errors) {
		console.error('GraphQL errors:', JSON.stringify(result.errors));
		throw new Error(`GraphQL errors: ${result.errors.map(e => e.message).join(', ')}`);
	}

	return result.data;
}

function secondsToTime(totalSeconds) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	function padTo2Digits(num) {
		return num.toString().padStart(2, '0');
	}

	return `${padTo2Digits(minutes)}:${padTo2Digits(seconds)}`;
}

function convertMiliseconds(miliseconds, format) {
	let days, hours, minutes, seconds, total_hours, total_minutes, total_seconds;
	
	total_seconds = parseInt(Math.floor(miliseconds / 1000));
	total_minutes = parseInt(Math.floor(total_seconds / 60));
	total_hours = parseInt(Math.floor(total_minutes / 60));
	days = parseInt(Math.floor(total_hours / 24));
  
	seconds = parseInt(total_seconds % 60);
	minutes = parseInt(total_minutes % 60);
	hours = parseInt(total_hours % 24);
	
	switch(format) {
	  case 's':
		  return total_seconds;
	  case 'm':
		  return total_minutes;
	  case 'h':
		  return total_hours;
	  case 'd':
		  return days;
	  default:
		  return `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m` : ''}`
	}
};

module.exports = {
	graphqlRequest,
	secondsToTime,
	convertMiliseconds
};
