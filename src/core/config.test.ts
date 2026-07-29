import {describe, expect, it} from 'vitest';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME, LEGACY_JSON_CONFIG_FILE_NAME} from './config.js';
import {loadToolConfig} from './config-lifecycle.js';

describe('loadToolConfig', () => {
	it('loads .worktree-runner-tui.jsonc with comments and preserves argv commands', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-config-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			`{
				// Process/session namespace.
				"namespace": "rojo-serve",
				"command": ["npm", "run", "serve"],
				"setupCommand": ["npm", "install"],
				"editorCommand": ["code", "--reuse-window"],
				"ports": [34872, 5173],
				"requiredFiles": ["package.json", "default.project.json"],
				"orphanMatchers": ["rbxtsc -w"],
			}`,
		);

		const config = await loadToolConfig({repoRoot: root});
		expect(config.namespace).toBe('rojo-serve');
		expect(config.command).toEqual(['npm', 'run', 'serve']);
		expect(config.setupCommand).toEqual([['npm', 'install']]);
		expect(config.editorCommand).toEqual(['code', '--reuse-window']);
		expect(config.port).toBe(34872);
		expect(config.ports).toEqual([34872, 5173]);
	});

	it('keeps loading legacy .worktree-command-tui.jsonc configs', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-config-legacy-jsonc-'));
		writeFileSync(
			path.join(root, LEGACY_CONFIG_FILE_NAME),
			JSON.stringify({
				namespace: 'legacy-serve',
				command: ['npm', 'run', 'serve'],
				port: 34872,
			}),
		);

		const config = await loadToolConfig({repoRoot: root});
		expect(config.namespace).toBe('legacy-serve');
		expect(config.command).toEqual(['npm', 'run', 'serve']);
	});

	it('keeps loading legacy .worktree-command-tui.json configs', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-config-legacy-json-'));
		writeFileSync(
			path.join(root, LEGACY_JSON_CONFIG_FILE_NAME),
			JSON.stringify({
				namespace: 'legacy-json-serve',
				command: ['npm', 'run', 'serve'],
				port: 34872,
			}),
		);

		const config = await loadToolConfig({repoRoot: root});
		expect(config.namespace).toBe('legacy-json-serve');
		expect(config.command).toEqual(['npm', 'run', 'serve']);
	});

	it('prefers the renamed config when both renamed and legacy files exist', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-config-precedence-'));
		writeFileSync(
			path.join(root, LEGACY_CONFIG_FILE_NAME),
			JSON.stringify({namespace: 'legacy-serve', command: ['npm', 'run', 'serve'], port: 34872}),
		);
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({namespace: 'renamed-serve', command: ['npm', 'run', 'serve'], port: 34872}),
		);

		const config = await loadToolConfig({repoRoot: root});
		expect(config.namespace).toBe('renamed-serve');
	});

	it('normalizes legacy single port configs into ports arrays', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-legacy-port-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({
				namespace: 'legacy-port-serve',
				command: ['npm', 'run', 'serve'],
				port: 34872,
			}),
		);

		const config = await loadToolConfig({repoRoot: root});
		expect(config.port).toBe(34872);
		expect(config.ports).toEqual([34872]);
	});

	it('throws a readable error when command is not a non-empty argv array', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-bad-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({namespace: 'rojo-serve', command: 'npm run serve'}),
		);

		await expect(loadToolConfig({repoRoot: root})).rejects.toThrow('command must be a non-empty string array');
	});

	it('throws a readable error when setupCommand is not a non-empty argv array', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-bad-setup-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({namespace: 'rojo-serve', command: ['npm', 'run', 'serve'], setupCommand: [], port: 34872}),
		);

		await expect(loadToolConfig({repoRoot: root})).rejects.toThrow('setupCommand must be a non-empty string array or an array of non-empty string arrays when set');
	});

	it('throws a readable error when editorCommand is not a non-empty argv array', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-bad-editor-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({namespace: 'rojo-serve', command: ['npm', 'run', 'serve'], editorCommand: 'code .', port: 34872}),
		);

		await expect(loadToolConfig({repoRoot: root})).rejects.toThrow('editorCommand must be a non-empty string array when set');
	});

	it('rejects namespace values that escape the namespace slot', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-namespace-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({namespace: '../rojo-serve', command: ['npm', 'run', 'serve'], port: 34872}),
		);

		await expect(loadToolConfig({repoRoot: root})).rejects.toThrow('namespace must match [A-Za-z0-9._-]+');
	});

	it('rejects ports outside the tcp range', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-port-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({namespace: 'rojo-serve', command: ['npm', 'run', 'serve'], port: 70000}),
		);

		await expect(loadToolConfig({repoRoot: root})).rejects.toThrow('port must be an integer between 1 and 65535');
	});

	it('rejects oversized config files before parsing them', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wctui-config-large-'));
		writeFileSync(
			path.join(root, CONFIG_FILE_NAME),
			JSON.stringify({
				namespace: 'rojo-serve',
				command: ['npm', 'run', 'serve'],
				port: 34872,
				requiredFiles: ['x'.repeat(100000)],
			}),
		);

		await expect(loadToolConfig({repoRoot: root})).rejects.toThrow('config file is too large');
	});
});
