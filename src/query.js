import wr from "wordreference-api";
import { Config } from "./config.js";

/** Matches 3 groups in `<from><to> <phrase>` */
const PARAMS_REGEX = /^(\w{2})(\w{2}) (.*)/;

/**
 * From https://github.com/fega/wordreference-api
 * All combinations available
 */
const AVAILABLE_LANGUAGES = ["es", "en", "it", "fr"];

/**
 * - Parses a parameters string in the form `<from><to> <phrase>`
 * - Queries WordReference for the translations
 * - Displays the results
 * @param {string} parameters
 */
export async function query(parameters) {

	// === Empty query ===

	if (!parameters || parameters.trim().length === 0) {
		return sendResult([getSyntaxExampleResult()]);
	}

	// === Parsing parameters ===

	// Check if input starts with what looks like language codes (4 chars)
	// Validate them early, before the full phrase is entered
	const langCheckRegex = /^(\w{2})(\w{2})/;
	const langCheckMatch = parameters.match(langCheckRegex);
	if (langCheckMatch?.length >= 3) {
		const potentialFromLang = langCheckMatch[1];
		const potentialToLang = langCheckMatch[2];
		
		// Validate languages early (even before full phrase is entered)
		const langValidation = validateLanguages(potentialFromLang, potentialToLang);
		if (!langValidation.valid) {
			return sendResult([getLanguageErrorResult(langValidation.error)]);
		}
	}

	// Try double language format first: <from><to> <phrase>
	let match = parameters.match(PARAMS_REGEX);
	if (match?.length >= 4) {
		const fromLang = match[1];
		const toLang = match[2];
		const phrase = match[3];

		// === Querying WordReference ===
		try {
			const resp = await wr(phrase, fromLang, toLang);
			if (resp?.translations?.length < 1) return sendResult();

			// Process and display results
			return displayTranslations(resp, fromLang, toLang, phrase);
		} catch (error) {
			return sendResult([getErrorResult("Check the text or internet connection.")]);
		}
	}


	// If nothing matches, show syntax help
	return sendResult([getSyntaxExampleResult()]);
}

function validateLanguages(fromLang, toLang) {
	if (!AVAILABLE_LANGUAGES.includes(fromLang)) {
		return { valid: false, error: `Source language "${fromLang}" is not available. Use: ${AVAILABLE_LANGUAGES.join(", ")}` };
	}
	if (!AVAILABLE_LANGUAGES.includes(toLang)) {
		return { valid: false, error: `Target language "${toLang}" is not available. Use: ${AVAILABLE_LANGUAGES.join(", ")}` };
	}
	if (fromLang === toLang) {
		return { valid: false, error: "Source and target languages cannot be the same." };
	}
	return { valid: true };
}

function displayTranslations(resp, fromLang, toLang, phrase) {
	// Flatten translations from each "section":
	const translations = resp.translations.reduce((acc, section) => {
		acc.push(...section.translations);
		return acc;
	}, []);

	const wrUrl = `https://www.wordreference.com/${fromLang}${toLang}/${phrase}`;

	const result = translations.map(translation => {
		const examples = [
			...translation.example.from,
			...translation.example.to
		];

		return {
			Title:
				`${translation.from} (${translation.fromType}) ➡️ ${translation.to} (${translation.toType})`,

			SubTitle: examples.join(" ➡️ "),

			IcoPath: Config.IcoPath,
			score: 100,

			jsonRPCAction: {
				method: "open_wordreference_page",
				parameters: [wrUrl]
			}
		};
	});

	sendResult(result);
}




function getSyntaxExampleResult() {
	return {
		Title: "<from><to> <text>",
		SubTitle: "Example: enes hello world   |   Available languages: en, es, it, fr",
		IcoPath: Config.IcoPath,
		score: 100
	};
}

function getLanguageErrorResult(errorMessage) {
	return {
		Title: "Language Error",
		SubTitle: errorMessage,
		IcoPath: Config.IcoPath,
		score: 100
	};
}

function getErrorResult(errorMessage) {
	return {
		Title: "Error",
		SubTitle: errorMessage,
		IcoPath: Config.IcoPath,
		score: 100
	};
}

function sendResult(result = []) {
	console.log(JSON.stringify({ result }));
}
