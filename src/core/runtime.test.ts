import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {readSessionRecord, getSessionPaths} from './session-store.js';
import {parseGitStatusSummary} from './git-metadata.js';
import {buildActions, toAppRow} from './runtime.js';
const TEST_GITHUB_OWNER = 'finn-inc';
const TEST_GITHUB_REPOSITORY = 'reclaim-the-forest';
const TEST_GITHUB_REMOTE_URL = `https://github.com/${TEST_GITHUB_OWNER}/${TEST_GITHUB_REPOSITORY}.git`;
const TEST_MERGED_PR_RESPONSE = JSON.stringify([{
	number: 2001,
	title: 'Already merged',
	html_url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2001',
	state: 'closed',
	draft: false,
	merged_at: '2026-05-31T00:00:00Z',
	base: {ref: 'develop'},
}]);

function buildGhPullRequestArgs(branch: string, state: 'all' | 'open'): string {
	return `api -X GET repos/${TEST_GITHUB_OWNER}/${TEST_GITHUB_REPOSITORY}/pulls -f state=${state} -f head=${TEST_GITHUB_OWNER}:${branch} -F per_page=1 --hostname github.com`;
}

function writeMockGhBinary(
	ghPath: string,
	callsPath: string,
	openArgs: string,
	allArgs: string,
): void {
	writeFileSync(ghPath, `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(callsPath)}
if [ "$*" = ${JSON.stringify(openArgs)} ]; then
	printf '[]'
	exit 0
fi
if [ "$*" = ${JSON.stringify(allArgs)} ]; then
	printf ${JSON.stringify(TEST_MERGED_PR_RESPONSE)}
	exit 0
fi
exit 2
`);
	chmodSync(ghPath, 0o755);
}

function writeMockBrowserBinary(browserPath: string, callsPath: string): void {
	writeFileSync(browserPath, `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(callsPath)}
`);
	chmodSync(browserPath, 0o755);
}

function commitTrackedFiles(root: string, ...files: string[]): void {
	execFileSync('git', ['add', ...files], {cwd: root});
	execFileSync('git', ['commit', '-m', 'add tracked files'], {cwd: root});
}


function initGitRepo(root: string): void {
	execFileSync('git', ['init'], {cwd: root});
	execFileSync('git', ['config', 'user.email', 'wctui@example.invalid'], {cwd: root});
	execFileSync('git', ['config', 'user.name', 'wctui test'], {cwd: root});
	writeFileSync(path.join(root, 'README.md'), 'test repo\n');
	execFileSync('git', ['add', 'README.md'], {cwd: root});
	execFileSync('git', ['commit', '-m', 'initial'], {cwd: root});
}

function writeRepoConfigAndPackage(root: string, namespace: string): void {
	writeFileSync(path.join(root, 'package.json'), '{}');
	execFileSync('git', ['remote', 'add', 'origin', TEST_GITHUB_REMOTE_URL], {cwd: root});
	writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
		namespace,
		command: ['node', '-e', 'console.log("ready")'],
		port: 31237,
		requiredFiles: ['package.json'],
		orphanMatchers: [],
	}));
}

describe('parseGitStatusSummary', () => {
	it('parses upstream, ahead/behind counts, and worktree dirtiness', () => {
		const summary = parseGitStatusSummary(`
# branch.oid 46af3f1cec1c61a50aa178552c55b5c6c3e5575e
# branch.head feat/worktree-command-tui
# branch.upstream origin/develop
# branch.ab +4 -24
1 MM N... 100644 100644 100644 abc def src/app.tsx
2 .M N... 100644 100644 100644 100644 abc def R100 src/old.tsx	src/new.tsx
u UU N... 100644 100644 100644 100644 100644 abc def ghi src/conflicted.ts
? src/untracked.ts
`);

		expect(summary.upstreamUnavailable).toBe(false);
		expect(summary.upstream).toEqual({branch: 'origin/develop', ahead: 4, behind: 24});
		expect(summary.workingTree).toEqual({staged: 1, unstaged: 2, untracked: 1, conflicts: 1});
	});

	it('keeps no-upstream branches distinct from unavailable metadata', () => {
		const summary = parseGitStatusSummary(`
# branch.oid 46af3f1cec1c61a50aa178552c55b5c6c3e5575e
# branch.head feat/worktree-command-tui
`);

		expect(summary.upstreamUnavailable).toBe(false);
		expect(summary.upstream).toBeUndefined();
		expect(summary.workingTree).toEqual({staged: 0, unstaged: 0, untracked: 0, conflicts: 0});
	});
});

describe('buildActions setup command', () => {
	it('runs setup manually and returns the setup log', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-setup-')));
		initGitRepo(root);
		writeFileSync(path.join(root, 'package.json'), '{}');
		writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
			namespace: 'runtime-setup',
			command: ['node', '-e', 'require("node:fs").writeFileSync("started.txt", "yes")'],
			setupCommand: ['node', '-e', 'console.log("setup output")'],
			port: 31234,
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		}));

		const actions = await buildActions(root);
		const model = await actions.setup(root);

		expect(model.status.message).toMatch(/^setup complete for /u);
		expect(model.logs[0]?.content).toContain('setup output');
	}, 15_000);

	it('does not run setup when starting a worktree', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-start-')));
		initGitRepo(root);
		writeFileSync(path.join(root, 'package.json'), '{}');
		writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
			namespace: 'runtime-start',
			command: ['node', '-e', 'require("node:fs").writeFileSync("started.txt", "yes")'],
			setupCommand: ['node', '-e', 'require("node:fs").writeFileSync("setup.txt", "no")'],
			port: 31235,
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		}));

		const actions = await buildActions(root);
		await actions.start(root);

		await vi.waitFor(() => expect(existsSync(path.join(root, 'started.txt'))).toBe(true));
		expect(existsSync(path.join(root, 'setup.txt'))).toBe(false);
	}, 15_000);

	it('adds local reflog branch creation time to rows', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-branch-created-')));
		initGitRepo(root);
		writeFileSync(path.join(root, 'package.json'), '{}');
		writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
			namespace: 'runtime-branch-created',
			command: ['node', '-e', 'console.log("ready")'],
			port: 31237,
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		}));

		const actions = await buildActions(root);
		const model = await actions.refresh();

		expect(typeof model.rows[0]?.branchCreatedAtMs).toBe('number');
		expect(Number.isFinite(model.rows[0]?.branchCreatedAtMs)).toBe(true);
	});
});

describe('pull request metadata', () => {
	it('uses gh api REST requests instead of gh pr list GraphQL requests', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-gh-api-pr-')));
		initGitRepo(root);
		writeRepoConfigAndPackage(root, 'runtime-gh-api-pr');
		const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
		const binDir = path.join(root, 'bin');
		mkdirSync(binDir);
		const callsPath = path.join(root, 'gh-calls.log');
		const ghPath = path.join(binDir, 'gh');
		const openArgs = buildGhPullRequestArgs(branch, 'open');
		const allArgs = buildGhPullRequestArgs(branch, 'all');
		writeMockGhBinary(ghPath, callsPath, openArgs, allArgs);
		const previousPath = process.env.PATH;
		process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

		try {
			const actions = await buildActions(root);
			const model = await actions.refresh();

			expect(model.rows[0]?.pullRequest).toEqual({
				kind: 'found',
				number: 2001,
				title: 'Already merged',
				url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2001',
				state: 'MERGED',
				isDraft: false,
				baseBranch: 'develop',
			});
			const calls = readFileSync(callsPath, 'utf8').trim().split('\n');
			const callLog = calls.join('\n');
			expect(calls).toEqual([openArgs, allArgs]);
			expect(callLog).not.toContain('graphql');
			expect(callLog).not.toContain('pr list');
		} finally {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	});
});

describe('buildActions worktree actions', () => {
	it('opens the configured editor with the selected worktree path appended', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-editor-')));
		const openedPathLog = path.join(root, 'editor-opened.txt');
		initGitRepo(root);
		writeFileSync(path.join(root, 'package.json'), '{}');
		writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
			namespace: 'runtime-editor',
			command: ['node', '-e', 'console.log("ready")'],
			editorCommand: ['node', '-e', 'require("node:fs").writeFileSync(process.argv[1], process.argv[2])', openedPathLog],
			port: 31238,
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		}));
		const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();

		const actions = await buildActions(root);
		const model = await actions.openEditor(root);

		await vi.waitFor(() => expect(readFileSync(openedPathLog, 'utf8')).toBe(root));
		expect(model.status).toEqual({kind: 'idle', message: `opened editor for ${branch}`});
	});

	it('opens the pull request URL in the OS browser', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-open-pr-')));
		initGitRepo(root);
		writeRepoConfigAndPackage(root, 'runtime-open-pr');
		const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
		const binDir = path.join(root, 'bin');
		mkdirSync(binDir);
		const ghCallsPath = path.join(root, 'gh-calls.log');
		const browserCallsPath = path.join(root, 'browser-calls.log');
		writeMockGhBinary(path.join(binDir, 'gh'), ghCallsPath, buildGhPullRequestArgs(branch, 'open'), buildGhPullRequestArgs(branch, 'all'));
		writeMockBrowserBinary(path.join(binDir, 'open'), browserCallsPath);
		const previousPath = process.env.PATH;
		process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ''}`;

		try {
			const actions = await buildActions(root);
			const model = await actions.openPullRequest(root);

			expect(model.status).toEqual({kind: 'idle', message: `opened pull request #2001 for ${branch}`});
			await vi.waitFor(() => expect(readFileSync(browserCallsPath, 'utf8').trim()).toBe('https://github.com/finn-inc/reclaim-the-forest/pull/2001'));
		} finally {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	});

	it('rejects deleting the main worktree in runtime code', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-delete-main-')));
		initGitRepo(root);
		writeRepoConfigAndPackage(root, 'runtime-delete-main');

		const actions = await buildActions(root);
		const model = await actions.deleteWorktree(root);

		expect(model.status).toEqual({kind: 'idle', message: 'cannot delete the main worktree'});
		expect(existsSync(root)).toBe(true);
	});

	it('removes the selected active worktree and clears its session record', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-delete-active-')));
		const worktreePath = path.join(root, '.worktrees', 'feat-delete-active');
		initGitRepo(root);
		writeFileSync(path.join(root, 'package.json'), '{}');
		writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
			namespace: 'runtime-delete-active',
			command: ['node', '-e', 'setInterval(() => {}, 1000)'],
			port: 31239,
			requiredFiles: ['package.json'],
			orphanMatchers: [],
		}));
		commitTrackedFiles(root, 'package.json', '.worktree-runner-tui.jsonc');
		execFileSync('git', ['worktree', 'add', '-b', 'feat/delete-active', worktreePath], {cwd: root});

		const actions = await buildActions(root);
		await actions.start(worktreePath);
		const deleted = await actions.deleteWorktree(worktreePath);
		const gitCommonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {cwd: root, encoding: 'utf8'}).trim();
		const sessionPaths = getSessionPaths(gitCommonDir, 'runtime-delete-active');

		await vi.waitFor(() => expect(existsSync(worktreePath)).toBe(false));
		expect(await readSessionRecord(sessionPaths, {isSessionAlive: async () => true})).toBeNull();
		expect(deleted.activePath).toBeNull();
		expect(deleted.activeBranch).toBeNull();
		expect(deleted.status).toEqual({kind: 'idle', message: 'deleted feat/delete-active'});
	});
});

it('keeps running status after setup when a session is active', async () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-runtime-active-')));
	initGitRepo(root);
	writeFileSync(path.join(root, 'package.json'), '{}');
	writeFileSync(path.join(root, '.worktree-runner-tui.jsonc'), JSON.stringify({
		namespace: 'runtime-active',
		command: ['node', '-e', 'setInterval(() => {}, 1000)'],
		setupCommand: ['node', '-e', 'console.log("setup while active")'],
		port: 31236,
		requiredFiles: ['package.json'],
		orphanMatchers: [],
	}));

	const actions = await buildActions(root);
	await actions.start(root);
	const model = await actions.setup(root);
	await actions.stop();

	expect(model.activePath).toBe(root);
	expect(model.status.kind).toBe('running');
	expect(model.status.message).toMatch(/^setup complete for /u);
	expect(model.logs[0]?.content).toContain('setup while active');
});
describe('toAppRow', () => {
	it('preserves collected metadata in the rendered row', () => {
		const headCommit = {message: 'Selection pane metadata'};
		const row = toAppRow(
			'/repo',
			{
				path: '/repo/.worktree/feat-a',
				branch: 'feat/a',
				headSha: '46af3f1cec1c61a50aa178552c55b5c6c3e5575e',
				isMain: false,
				isExternal: false,
				createdAtMs: null,
			},
			null,
			null,
			{
				upstreamUnavailable: true,
				branchCreatedAtMs: 1_780_000_000_000,
				workingTree: {staged: 0, unstaged: 1, untracked: 2, conflicts: 0},
				pullRequest: {
					kind: 'found',
					number: 2125,
					title: 'Selection pane metadata',
					url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125',
					state: 'OPEN',
					isDraft: true,
					baseBranch: 'develop',
				},
				headCommit,
			},
		);

		expect(row.upstreamUnavailable).toBe(true);
		expect(row.branchCreatedAtMs).toBe(1_780_000_000_000);
		expect(row.workingTree).toEqual({staged: 0, unstaged: 1, untracked: 2, conflicts: 0});
		expect(row.pullRequest).toEqual({
			kind: 'found',
			number: 2125,
			title: 'Selection pane metadata',
			url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125',
			state: 'OPEN',
			isDraft: true,
			baseBranch: 'develop',
		});
		expect(row.headSha).toBe('46af3f1c');
		expect(row.headCommit).toEqual(headCommit);
		expect(row.shortPath).toBe('.worktree/feat-a');
	});
});
