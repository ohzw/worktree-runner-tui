#!/usr/bin/env node
import {createConfigForRepo, parseInitArgs} from './core/init.js';
import {CONFIG_FILE_NAME, CONFIG_FILE_NAMES} from './core/config.js';
import {sanitizeInlineText} from './core/worktree-projection.js';
import {ThemeProvider} from '@inkjs/ui';
import {render} from 'ink';
import {APP_RENDER_OPTIONS} from './render-options.js';
import {App, RESIZE_DEBOUNCE_MS} from './app.js';
import {buildActions, buildInitialModel} from './core/runtime.js';
import {debounceResizeListeners} from './core/debounced-resize.js';
import {appTheme} from './ui-theme.js';

const cwd = process.cwd();
const args = process.argv.slice(2);
const [, , subcommand] = process.argv;

function printUsage(): void {
	console.log('Usage:');
	console.log('  wtr [args...]');
	console.log('  wtr init [--force]');
}

function isConfigMissingError(error: unknown): boolean {
	const err = error as {code?: string; path?: string};
	return err.code === 'ENOENT' && typeof err.path === 'string' && CONFIG_FILE_NAMES.some(fileName => err.path?.endsWith(fileName));
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		if (isConfigMissingError(error)) {
			return `${error.message}
Run "wtr init" to generate ${CONFIG_FILE_NAME} before starting the TUI.`;
		}
		return error.message;
	}
	return 'An unexpected error occurred';
}

async function handleInitCommand(): Promise<void> {
	let parsed: {force: boolean; help: boolean};
	try {
		parsed = parseInitArgs(args.slice(1));
	} catch (error) {
		console.error(sanitizeInlineText((error as Error).message));
		process.exit(1);
	}

	if (parsed.help) {
		printUsage();
		return;
	}

	try {
		const result = await createConfigForRepo({cwd, force: parsed.force});
		console.log(`Created ${sanitizeInlineText(result.path)}`);
	} catch (error) {
		console.error(sanitizeInlineText((error as Error).message));
		process.exit(1);
	}
}

if (subcommand === 'init') {
	await handleInitCommand();
	process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
	printUsage();
	process.exit(0);
}

if (subcommand !== undefined) {
	console.error(`Unknown command: ${sanitizeInlineText(subcommand)}`);
	process.exit(1);
}

let restoreStdoutResize = () => {};

try {
	const [initialModel, actions] = await Promise.all([buildInitialModel(cwd), buildActions(cwd)]);
	const createApp = () => (
		<ThemeProvider theme={appTheme}>
			<App initialModel={initialModel} actions={actions} />
		</ThemeProvider>
	);
	if (process.stdout.isTTY) {
		restoreStdoutResize = debounceResizeListeners(process.stdout, RESIZE_DEBOUNCE_MS);
	}
	const instance = render(createApp(), APP_RENDER_OPTIONS);
	if (process.stdout.isTTY) {
		void instance.waitUntilExit().finally(() => {
			restoreStdoutResize();
		});
	}
} catch (error) {
	restoreStdoutResize();
	console.error(sanitizeInlineText(describeError(error)));
	process.exit(1);
}
