import {describe, expect, it} from 'vitest';
import {accessSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseInitArgs, renderConfigJsonc, runInit} from './init.js';
import {CONFIG_FILE_NAME, LEGACY_CONFIG_FILE_NAME, parseJsonc} from './config.js';

describe('runInit', () => {
	it('creates a config file with defaults derived from project metadata', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-init-'));
		const packageJson = {
			name: 'example-app',
			packageManager: 'bun@1.2.3',
			scripts: {
				dev: 'bun run dev',
				start: 'bun run start',
			},
		};
		writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
		const result = await runInit({workspaceRoot: root, force: false});
		const source = readFileSync(result.path, 'utf8');
		const written = parseJsonc(source) as Record<string, unknown>;

		expect(result.path).toBe(path.join(root, CONFIG_FILE_NAME));
		expect(source).toContain('// Command launched in the selected worktree when you press Enter.');
		expect(written).toMatchObject({
			namespace: 'example-app',
			command: ['bun', 'run', 'dev'],
			setupCommand: [['bun', 'install']],
			editorCommand: ['code'],
			ports: [3000],
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		});
	});

	it('uses an explicit alternative script when dev/start/serve are missing', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-init-fallback-'));
		const packageJson = {
			name: 'example-app',
			scripts: {
				watch: 'vite',
				devnull: 'vite build',
			},
		};
		writeFileSync(path.join(root, 'package.json'), JSON.stringify(packageJson));
		const result = await runInit({workspaceRoot: root, force: true});
		const written = parseJsonc(readFileSync(result.path, 'utf8')) as Record<string, unknown>;
		expect((written.command as string[])[2]).toBe('watch');
	});

	it('omits setupCommand when rendering a config that does not define it', () => {
		const source = renderConfigJsonc({
			namespace: 'example-app',
			command: ['npm', 'run', 'dev'],
			port: 3000,
			ports: [3000],
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		});

		expect(source).not.toContain('undefined');
		expect(parseJsonc(source)).not.toHaveProperty('setupCommand');
	});

	it('refuses to overwrite an existing config without --force', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-init-existing-'));
		const configPath = path.join(root, CONFIG_FILE_NAME);
		writeFileSync(configPath, '{}');
		expect(runInit({workspaceRoot: root, force: false})).rejects.toThrow(`Config file already exists: ${configPath}`);
	});

	it('refuses to overwrite a legacy config without --force', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-init-existing-legacy-'));
		const configPath = path.join(root, LEGACY_CONFIG_FILE_NAME);
		writeFileSync(configPath, '{}');
		expect(runInit({workspaceRoot: root, force: false})).rejects.toThrow(`Config file already exists: ${configPath}`);
	});

	it('overwrites an existing config when force is set', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'wtr-init-force-'));
		const configPath = path.join(root, CONFIG_FILE_NAME);
		writeFileSync(configPath, '{}');

		await runInit({workspaceRoot: root, force: true});
		expect(() => accessSync(configPath)).not.toThrow();
		const written = readFileSync(configPath, 'utf8');
		expect(written).toContain('"command"');
		expect(written).toContain('"setupCommand"');
		expect(written).toContain('"editorCommand"');
	});
});

describe('parseInitArgs', () => {
	it('supports --force and --help toggles', () => {
		const parsed = parseInitArgs(['--force', '--help']);
		expect(parsed.force).toBe(true);
		expect(parsed.help).toBe(true);
	});

	it('throws on unknown flags', () => {
		expect(() => parseInitArgs(['--bad'])).toThrow('Unknown argument: --bad');
	});
});
