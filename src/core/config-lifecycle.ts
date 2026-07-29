import {readFile, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {CONFIG_FILE_NAME, CONFIG_FILE_NAMES, parseJsonc, type ToolConfig} from './config.js';

const SAFE_NAMESPACE_PATTERN = /^[A-Za-z0-9._-]+$/u;
const UNSAFE_NAMESPACE_RUN_PATTERN = /[^A-Za-z0-9._-]+/gu;
const LEADING_NAMESPACE_HYPHENS_PATTERN = /^-+/u;
const TRAILING_NAMESPACE_HYPHENS_PATTERN = /-+$/u;
const SAFE_NAMESPACE_DESCRIPTION = '[A-Za-z0-9._-]+';
const DEFAULT_NAMESPACE = 'worktree-runner-tui';
const MAX_CONFIG_BYTES = 64 * 1024;


export interface DefaultToolConfigOptions {
	namespaceSeed: string;
	packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm';
	script: string;
}

export interface ConfigInitResult {
	path: string;
	config: ToolConfig;
}

export interface ConfigInitOptions {
	workspaceRoot: string;
	force: boolean;
	config: ToolConfig;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

export function isSafeNamespace(value: unknown): value is string {
	return isNonEmptyString(value) && SAFE_NAMESPACE_PATTERN.test(value);
}

export function toSafeNamespace(value: string): string {
	const replaced = value.replace(UNSAFE_NAMESPACE_RUN_PATTERN, '-');
	const trimmed = replaced.replace(LEADING_NAMESPACE_HYPHENS_PATTERN, '').replace(TRAILING_NAMESPACE_HYPHENS_PATTERN, '');
	return isSafeNamespace(trimmed) ? trimmed : DEFAULT_NAMESPACE;
}

function readStringList(value: unknown, fieldName: string): string[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value) || value.some(item => !isNonEmptyString(item))) {
		throw new Error(`${fieldName} must be a string array`);
	}
	return value;
}

function readOrphanMatchers(value: unknown): string[] {
	const matchers = readStringList(value, 'orphanMatchers');
	for (const matcher of matchers) {
		if (!/\S+\s+\S+/u.test(matcher)) {
			throw new Error('orphanMatchers entries must include a command plus argument fragment');
		}
	}
	return matchers;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every(part => isNonEmptyString(part));
}

function readOptionalSetupCommands(value: unknown): string[][] | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value) || value.length === 0) {
		throw new Error('setupCommand must be a non-empty string array or an array of non-empty string arrays when set');
	}

	const looksLikeSingleCommand = value.every(part => isNonEmptyString(part));
	if (looksLikeSingleCommand) {
		return [value];
	}

	if (!value.every(part => Array.isArray(part))) {
		throw new Error('setupCommand must be a non-empty string array or an array of non-empty string arrays when set');
	}

	if (!value.every(part => isNonEmptyStringArray(part))) {
		throw new Error('setupCommand must be a non-empty string array or an array of non-empty string arrays when set');
	}

	return value as string[][];
}

function readRequiredCommand(value: unknown, fieldName: string): string[] {
	if (!Array.isArray(value) || value.length === 0 || value.some(part => !isNonEmptyString(part))) {
		throw new Error(`${fieldName} must be a non-empty string array`);
	}
	return value;
}

function readOptionalCommand(value: unknown, fieldName: string): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value) || value.length === 0 || value.some(part => !isNonEmptyString(part))) {
		throw new Error(`${fieldName} must be a non-empty string array when set`);
	}
	return value;
}

function readPort(value: unknown, fieldName: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`${fieldName} must be an integer between 1 and 65535`);
	}
	return value;
}

function readPorts(value: unknown): number[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value) || value.length === 0 || value.some(port => typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)) {
		throw new Error('ports must be a non-empty array of integers between 1 and 65535');
	}
	return value;
}

function uniquePorts(ports: number[]): number[] {
	return [...new Set(ports)];
}

function mergeConfiguredPorts(legacyPort: number | undefined, configuredPorts: number[]): number[] {
	const merged = configuredPorts.length > 0 ? configuredPorts : legacyPort === undefined ? [] : [legacyPort];
	const resolved = uniquePorts(merged);
	if (resolved.length === 0) {
		throw new Error('port or ports must be configured');
	}
	return resolved;
}

function readPortList(port: unknown, ports: unknown): number[] {
	const legacyPort = port === undefined ? undefined : readPort(port, 'port');
	const configuredPorts = readPorts(ports);
	return mergeConfiguredPorts(legacyPort, configuredPorts);
}

export function validateToolConfig(raw: unknown): ToolConfig {
	const config = (raw ?? {}) as Partial<ToolConfig>;
	const command = readRequiredCommand(config.command, 'command');
	if (!isSafeNamespace(config.namespace)) {
		throw new Error(`namespace must match ${SAFE_NAMESPACE_DESCRIPTION}`);
	}

	const ports = readPortList(config.port, (config as {ports?: unknown}).ports);
	return {
		namespace: config.namespace,
		command,
		setupCommand: readOptionalSetupCommands(config.setupCommand),
		editorCommand: readOptionalCommand(config.editorCommand, 'editorCommand'),
		port: ports[0] ?? 0,
		ports,
		requiredFiles: readStringList(config.requiredFiles, 'requiredFiles'),
		orphanMatchers: readOrphanMatchers(config.orphanMatchers),
	};
}

export function createDefaultToolConfig(options: DefaultToolConfigOptions): ToolConfig {
	return validateToolConfig({
		namespace: toSafeNamespace(options.namespaceSeed),
		command: [options.packageManager, 'run', options.script],
		setupCommand: [[options.packageManager, 'install']],
		editorCommand: ['code'],
		ports: [3000],
		requiredFiles: ['package.json'],
		orphanMatchers: [],
	});
}

export function renderConfigJsonc(config: ToolConfig): string {
	const setupCommandSection = config.setupCommand === undefined ? '' : `
  // Optional command(s) run manually with the setup key in the selected worktree.
  // Review before running in untrusted worktrees; package installs may run lifecycle scripts.
  // When this is an array of arrays, each entry is executed in order.
  // Built-in helper: ["copy-root-file", ".env", ".env"]
  // copies .env from the repository root to the selected worktree.
  "setupCommand": ${JSON.stringify(config.setupCommand)},
`;
	const editorCommandSection = config.editorCommand === undefined ? '' : `
  // Optional command that opens the selected worktree path in an editor.
  // The selected worktree path is appended as the final argv entry.
  "editorCommand": ${JSON.stringify(config.editorCommand)},
`;
	return `{
  // Session namespace used for git-common-dir state files and logs.
  // Keep this filesystem-safe: letters, numbers, dots, underscores, and hyphens only.
  "namespace": ${JSON.stringify(config.namespace)},

  // Command launched in the selected worktree when you press Enter.
  // Treat this config as trusted code. argv form avoids shell metacharacter expansion.
  "command": ${JSON.stringify(config.command)},
${setupCommandSection}${editorCommandSection}
  // TCP ports owned by the command, used when stopping stale/orphaned processes.
  // Include all ports your command may bind.
  "ports": ${JSON.stringify(config.ports)},

  // Files that must exist in a worktree before the command can be started there.
  "requiredFiles": ${JSON.stringify(config.requiredFiles)},

  // Extra command-line substrings for cleanup within the recorded process group only.
  // Include a command plus argument fragment; broad single-token matchers are rejected.
  // Example: ["node --watch", "vite --host 0.0.0.0"]
  "orphanMatchers": ${JSON.stringify(config.orphanMatchers)},
}
`;
}


async function readConfigFile(configPath: string): Promise<string> {
	if ((await stat(configPath)).size > MAX_CONFIG_BYTES) {
		throw new Error('config file is too large');
	}
	return readFile(configPath, 'utf8');
}

async function readFirstConfig(repoRoot: string): Promise<string> {
	let firstError: unknown;
	for (const fileName of CONFIG_FILE_NAMES) {
		try {
			return await readConfigFile(path.join(repoRoot, fileName));
		} catch (error) {
			firstError ??= error;
		}
	}
	throw firstError;
}

export async function loadToolConfig({repoRoot}: {repoRoot: string}): Promise<ToolConfig> {
	return validateToolConfig(parseJsonc(await readFirstConfig(repoRoot)));
}


export async function findExistingConfigPath(workspaceRoot: string, fileExists: (filePath: string) => Promise<boolean>): Promise<string | null> {
	for (const fileName of CONFIG_FILE_NAMES) {
		const configPath = path.join(workspaceRoot, fileName);
		if (await fileExists(configPath)) {
			return configPath;
		}
	}
	return null;
}

export async function writeToolConfigForRepo({workspaceRoot, force, config}: ConfigInitOptions, fileExists: (filePath: string) => Promise<boolean>): Promise<ConfigInitResult> {
	const configPath = path.join(workspaceRoot, CONFIG_FILE_NAME);
	const existingConfigPath = await findExistingConfigPath(workspaceRoot, fileExists);
	if (!force && existingConfigPath) {
		throw new Error(`Config file already exists: ${existingConfigPath}`);
	}

	const validatedConfig = validateToolConfig(config);
	await writeFile(configPath, renderConfigJsonc(validatedConfig), 'utf8');
	return {path: configPath, config: validatedConfig};
}
