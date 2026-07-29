import {describe, expect, it} from 'vitest';
import {parseJsonc} from './config.js';
import {createDefaultToolConfig, renderConfigJsonc, toSafeNamespace, validateToolConfig} from './config-lifecycle.js';

const validConfig = {
	namespace: 'example-app',
	command: ['npm', 'run', 'dev'],
	setupCommand: [['npm', 'install']],
	editorCommand: ['code', '--reuse-window'],
	port: 3000,
	ports: [3000],
	requiredFiles: ['package.json'],
	orphanMatchers: [],
};

describe('validateToolConfig', () => {
	it('normalizes missing optional lists to the same defaults used by init', () => {
		expect(
			validateToolConfig({namespace: 'example-app', command: ['npm', 'run', 'dev'], port: 3000, ports: [4000, 4001], orphanMatchers: []}),
	).toEqual({
		namespace: 'example-app',
		command: ['npm', 'run', 'dev'],
		setupCommand: undefined,
		editorCommand: undefined,
		port: 4000,
		ports: [4000, 4001],
		requiredFiles: [],
		orphanMatchers: [],
	});
	});

	it('accepts ports arrays from new config', () => {
		expect(
			validateToolConfig({
				namespace: 'example-app',
				command: ['npm', 'run', 'dev'],
				ports: [3001, 3002],
				orphanMatchers: [],
			}),
	).toEqual({
		namespace: 'example-app',
		command: ['npm', 'run', 'dev'],
		setupCommand: undefined,
		editorCommand: undefined,
		port: 3001,
		ports: [3001, 3002],
		requiredFiles: [],
		orphanMatchers: [],
	});
	});

	it('accepts generated default configs without changing public fields', () => {
		const config = createDefaultToolConfig({
			namespaceSeed: 'example app',
			packageManager: 'npm',
			script: 'start',
		});

		expect(validateToolConfig(config)).toEqual({
			namespace: 'example-app',
			command: ['npm', 'run', 'start'],
			setupCommand: [['npm', 'install']],
			editorCommand: ['code'],
			port: 3000,
			ports: [3000],
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		});
	});

	it('round-trips editorCommand through jsonc rendering', () => {
		expect(validateToolConfig(parseJsonc(renderConfigJsonc(validConfig)))).toEqual(validConfig);
	});

	it('rejects invalid namespaces with the public load error', () => {
		expect(() => validateToolConfig({...validConfig, namespace: '../example-app'})).toThrow(
			'namespace must match [A-Za-z0-9._-]+',
		);
	});

	it('rejects command values that are not non-empty argv arrays', () => {
		expect(() => validateToolConfig({...validConfig, command: 'npm run dev'})).toThrow(
			'command must be a non-empty string array',
		);
		expect(() => validateToolConfig({...validConfig, command: []})).toThrow('command must be a non-empty string array');
	});

	it('rejects malformed optional command and list fields with public load errors', () => {
		expect(() => validateToolConfig({...validConfig, setupCommand: []})).toThrow(
			'setupCommand must be a non-empty string array or an array of non-empty string arrays when set',
		);
		expect(() => validateToolConfig({...validConfig, editorCommand: 'code .'})).toThrow(
			'editorCommand must be a non-empty string array when set',
		);
		expect(() => validateToolConfig({...validConfig, requiredFiles: ['package.json', '']})).toThrow(
			'requiredFiles must be a string array',
		);
		expect(() => validateToolConfig({...validConfig, orphanMatchers: 'vite'})).toThrow(
			'orphanMatchers must be a string array',
		);
	});

	it('rejects broad orphan matchers that could target unrelated processes', () => {
		expect(() => validateToolConfig({...validConfig, orphanMatchers: ['node']})).toThrow(
			'orphanMatchers entries must include a command plus argument fragment',
		);
		expect(() => validateToolConfig({...validConfig, orphanMatchers: ['vite --host']})).not.toThrow();
	});

	it('rejects invalid ports and requires at least one configured port', () => {
		expect(() => validateToolConfig({...validConfig, port: 0})).toThrow(
			'port must be an integer between 1 and 65535',
		);
		expect(() => validateToolConfig({...validConfig, port: 65_536})).toThrow(
			'port must be an integer between 1 and 65535',
		);
		expect(() => validateToolConfig({...validConfig, ports: []})).toThrow(
			'ports must be a non-empty array of integers between 1 and 65535',
		);
		expect(() => validateToolConfig({...validConfig, port: undefined, ports: []})).toThrow('ports must be a non-empty array of integers between 1 and 65535');
	});
});

describe('toSafeNamespace', () => {
	it('replaces unsafe runs and falls back when no safe namespace remains', () => {
		expect(toSafeNamespace('@scope/example app')).toBe('scope-example-app');
		expect(toSafeNamespace('///')).toBe('worktree-runner-tui');
	});
});
