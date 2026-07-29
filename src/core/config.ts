export const CONFIG_FILE_NAME = '.worktree-runner-tui.jsonc';
export const JSON_CONFIG_FILE_NAME = '.worktree-runner-tui.json';
export const LEGACY_CONFIG_FILE_NAME = '.worktree-command-tui.jsonc';
export const LEGACY_JSON_CONFIG_FILE_NAME = '.worktree-command-tui.json';
export const CONFIG_FILE_NAMES = [
	CONFIG_FILE_NAME,
	JSON_CONFIG_FILE_NAME,
	LEGACY_CONFIG_FILE_NAME,
	LEGACY_JSON_CONFIG_FILE_NAME,
] as const;

export interface ToolConfig {
	namespace: string;
	command: string[];
	// argv list of setup commands executed in order.
	setupCommand?: string[][];
	editorCommand?: string[];
	// Canonical primary port for backwards compatibility with older session records.
	port: number;
	// All ports owned by the command for best-effort cleanup.
	ports: number[];
	requiredFiles: string[];
	orphanMatchers: string[];
}

function stripJsoncComments(source: string): string {
	let result = '';
	let inString = false;
	let escaping = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = 0; index < source.length; index += 1) {
		const current = source[index];
		const next = source[index + 1];

		if (inLineComment) {
			if (current === '\n' || current === '\r') {
				inLineComment = false;
				result += current;
			}
			continue;
		}

		if (inBlockComment) {
			if (current === '*' && next === '/') {
				inBlockComment = false;
				index += 1;
				continue;
			}
			result += current === '\n' || current === '\r' ? current : ' ';
			continue;
		}

		if (inString) {
			result += current;
			if (escaping) {
				escaping = false;
				continue;
			}
			if (current === '\\') {
				escaping = true;
				continue;
			}
			if (current === '"') {
				inString = false;
			}
			continue;
		}

		if (current === '"') {
			inString = true;
			result += current;
			continue;
		}
		if (current === '/' && next === '/') {
			inLineComment = true;
			index += 1;
			continue;
		}
		if (current === '/' && next === '*') {
			inBlockComment = true;
			index += 1;
			continue;
		}
		result += current;
	}

	return result;
}

function stripTrailingCommas(source: string): string {
	let result = '';
	let inString = false;
	let escaping = false;

	for (let index = 0; index < source.length; index += 1) {
		const current = source[index];

		if (inString) {
			result += current;
			if (escaping) {
				escaping = false;
				continue;
			}
			if (current === '\\') {
				escaping = true;
				continue;
			}
			if (current === '"') {
				inString = false;
			}
			continue;
		}

		if (current === '"') {
			inString = true;
			result += current;
			continue;
		}

		if (current === ',') {
			let lookahead = index + 1;
			while (lookahead < source.length && /\s/u.test(source[lookahead] ?? '')) {
				lookahead += 1;
			}
			if (source[lookahead] === '}' || source[lookahead] === ']') {
				continue;
			}
		}

		result += current;
	}

	return result;
}

export function parseJsonc(source: string): unknown {
	return JSON.parse(stripTrailingCommas(stripJsoncComments(source)));
}

