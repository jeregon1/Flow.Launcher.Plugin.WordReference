import { Config } from "./config.js";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { execFileSync } = require("child_process");
const https = require("https");

/** Matches 3 groups in `<from><to> <phrase>` */
const PARAMS_REGEX = /^(\w{2})(\w{2}) (.*)/;

/** Available language codes */
const AVAILABLE_LANGUAGES = ["es", "en", "it", "fr"];

export async function query(parameters) {
	if (!parameters || parameters.trim().length === 0) {
		return sendResult([getSyntaxExampleResult()]);
	}

	// Early language validation
	const langCheckRegex = /^(\w{2})(\w{2})/;
	const langCheckMatch = parameters.match(langCheckRegex);
	if (langCheckMatch?.length >= 3) {
		const langValidation = validateLanguages(langCheckMatch[1], langCheckMatch[2]);
		if (!langValidation.valid) {
			return sendResult([getLanguageErrorResult(langValidation.error)]);
		}
	}

	const match = parameters.match(PARAMS_REGEX);
	if (match?.length >= 4) {
		const fromLang = match[1];
		const toLang = match[2];
		const phrase = removeAccents(match[3]);

		try {
			const html = await fetchWordReference(phrase, fromLang, toLang);
			const cheerio = require("cheerio");
			const resp = parseWordReferenceHtml(cheerio, html);
			if (!resp?.translations?.length) return sendResult();
			return displayTranslations(resp, fromLang, toLang, phrase);
		} catch (error) {
			return sendResult([getErrorResult("Check the text or internet connection.")]);
		}
	}

	return sendResult([getSyntaxExampleResult()]);
}

function fetchWordReference(word, fromLang, toLang) {
	return new Promise((resolve, reject) => {
		const url = `https://www.wordreference.com/${fromLang}${toLang}/${encodeURIComponent(word)}`;

		try {
			const stdout = execFileSync("curl.exe", [
				"-s", "-L",
				"-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
				"-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"-H", "Accept-Language: en-US,en;q=0.9",
				url,
			], { encoding: "utf-8", timeout: 15000, maxBuffer: 512 * 1024 });
			resolve(stdout);
			return;
		} catch (_) {
			// fall through to https
		}

		// Fallback: Node.js https
		const options = {
			hostname: "www.wordreference.com",
			path: `/${fromLang}${toLang}/${encodeURIComponent(word)}`,
			method: "GET",
			headers: {
				"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
				"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
			},
		};
		makeRequest(options, [], resolve, reject, 0);
	});
}

function makeRequest(options, cookies, resolve, reject, attempt) {
	const maxRetries = 3;
	const reqOptions = { ...options };
	if (cookies.length > 0) {
		reqOptions.headers = { ...reqOptions.headers, Cookie: cookies.join("; ") };
	}

	const req = https.request(reqOptions, (res) => {
		if (res.statusCode === 418 && res.headers["set-cookie"] && attempt < maxRetries) {
			const newCookies = res.headers["set-cookie"].map(c => c.split(";")[0]);
			makeRequest(options, [...new Set([...cookies, ...newCookies])], resolve, reject, attempt + 1);
			return;
		}
		if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
			if (attempt < maxRetries) {
				const redirectUrl = new URL(res.headers.location, `https://${options.hostname}`);
				makeRequest({ ...options, hostname: redirectUrl.hostname, path: redirectUrl.pathname + redirectUrl.search },
					cookies, resolve, reject, attempt + 1);
			} else {
				reject(new Error("Too many redirects"));
			}
			return;
		}
		if (res.statusCode < 200 || res.statusCode >= 300) {
			reject(new Error(`HTTP ${res.statusCode}`));
			return;
		}
		const chunks = [];
		res.on("data", chunk => chunks.push(chunk));
		res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
	});
	req.on("error", reject);
	req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
	req.end();
}

function parseWordReferenceHtml(cheerio, html) {
	const $ = cheerio.load(html);
	const result = { word: "", pronWR: "", audio: [], translations: [] };
	result.word = $("h3.headerWord").text();
	result.pronWR = $("span#pronWR").text();
	result.audio = $("div#listen_widget audio source").map(function() { return $(this).attr("src"); }).get();

	const tables = $("table.WRD").map(function() { return $(this).html(); }).get();
	result.translations = tables.map(html => WRDtableMap(cheerio, html));
	return result;
}

function WRDtableMap(cheerio, html) {
	const $ = cheerio.load(html);
	const result = { title: "", translations: [] };

	$("tr").each(function() {
		const el = $(this);
		const h = el.html();
		if (el.attr("class") === "wrtopsection") {
			result.title = el.text();
		} else {
			const id = el.attr("id");
			const cls = el.attr("class");
			if (id !== undefined && (cls === "even" || cls === "odd")) {
				result.translations.push(createTranslationItem(cheerio, h));
			} else if (id === undefined && (cls === "even" || cls === "odd")) {
				const $2 = cheerio.load(h);
				const last = result.translations[result.translations.length - 1];
				if (last) {
					if ($2(".FrEx").text() !== "") last.example.from.push($2(".FrEx").text());
					else if ($2(".ToEx").text() !== "") last.example.to.push($2(".ToEx").text());
				}
			}
		}
	});
	return result;
}

function createTranslationItem(cheerio, html) {
	const $ = cheerio.load(html);
	const from = $("strong").text();
	$(".ToWrd em span, .FrWrd em span").remove();
	const fromType = $(".FrWrd em").text();
	const toType = $(".ToWrd em").text();
	$(".ToWrd em").remove();
	const to = $(".ToWrd").text();
	return { from, fromType, toType, to, example: { from: [], to: [] } };
}

function validateLanguages(fromLang, toLang) {
	if (!AVAILABLE_LANGUAGES.includes(fromLang)) return { valid: false, error: `Source "${fromLang}" not available. Use: ${AVAILABLE_LANGUAGES.join(", ")}` };
	if (!AVAILABLE_LANGUAGES.includes(toLang)) return { valid: false, error: `Target "${toLang}" not available. Use: ${AVAILABLE_LANGUAGES.join(", ")}` };
	if (fromLang === toLang) return { valid: false, error: "Languages cannot be the same." };
	return { valid: true };
}

function removeAccents(str) { return str.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function displayTranslations(resp, fromLang, toLang, phrase) {
	const flat = resp.translations.reduce((acc, s) => { acc.push(...s.translations); return acc; }, []);
	const url = `https://www.wordreference.com/${fromLang}${toLang}/${encodeURIComponent(phrase)}`;
	const results = flat.map(t => ({
		Title: `${t.from} (${t.fromType}) ➡️ ${t.to} (${t.toType})`,
		SubTitle: [...t.example.from, ...t.example.to].join(" ➡️ "),
		IcoPath: Config.IcoPath,
		score: 100,
		jsonRPCAction: { method: "open_wordreference_page", parameters: [url] }
	}));
	sendResult(results);
}

function getSyntaxExampleResult() {
	return { Title: "<from><to> <text>", SubTitle: "Example: enes hello world   |   Available: en, es, it, fr", IcoPath: Config.IcoPath, score: 100 };
}

function getLanguageErrorResult(msg) { return { Title: "Language Error", SubTitle: msg, IcoPath: Config.IcoPath, score: 100 }; }

function getErrorResult(msg) { return { Title: "Error", SubTitle: msg, IcoPath: Config.IcoPath, score: 100 }; }

function sendResult(result = []) { console.log(JSON.stringify({ result })); }
