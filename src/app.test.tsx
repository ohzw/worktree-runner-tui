import {render} from 'ink-testing-library';
import {expect, it, vi} from 'vitest';
import {App, getModelAfterLogRefresh, getMouseWheelDelta, getShellDimensions, shouldStackPanes, shouldUseCompactLayout, shouldUseMinimalLayout} from './app.js';
import type {AppActions, AppModel, RowTag} from './core/runtime.js';
import {APP_RENDER_OPTIONS} from './render-options.js';

function makeFakeActions(result: AppModel): AppActions {
	return {
		start: vi.fn(async () => result),
		setup: vi.fn(async () => result),
		stop: vi.fn(async () => result),
		refresh: vi.fn(async () => result),
		refreshLogs: vi.fn(async () => ({logs: result.logs, activePath: result.activePath, activeBranch: result.activeBranch})),
		openEditor: vi.fn(async () => result),
		openPullRequest: vi.fn(async () => result),
		deleteWorktree: vi.fn(async () => result),
	};
}

function createModel(overrides: Partial<AppModel> = {}): AppModel {
	return {
		repoName: 'reclaim-the-forest',
		namespace: 'rojo-serve',
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: ['active']},
			{path: '/repo-other', shortPath: '/repo-other', branch: 'fix/x', tags: ['external']},
		],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
		status: {kind: 'idle', message: 'ready'},
		setupAvailable: false,
		editorAvailable: true,
		logs: [
			{name: 'feat-a.log', path: '/repo/.git/worktree-command-tui/logs/feat-a.log', content: 'ready\nserver started'},
		],
		...overrides,
	};
}

async function waitForInput(): Promise<void> {
	await new Promise(resolve => {
		setTimeout(resolve, 10);
	});
}
function stripAnsi(value: string | null | undefined): string {
	return (value ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}


it('uses alternate screen and incremental rendering options', () => {
	expect(APP_RENDER_OPTIONS).toEqual({alternateScreen: true, exitOnCtrlC: true, incrementalRendering: true});
});

it('uses the full terminal width for pane layout', () => {
	expect(getShellDimensions(8, 8)).toEqual({rootWidth: 8, rootHeight: 8, bodyWidth: 8, listWidth: 1, actionWidth: 6});
	expect(getShellDimensions(45, 12)).toEqual({rootWidth: 45, rootHeight: 12, bodyWidth: 45, listWidth: 14, actionWidth: 30});
	expect(getShellDimensions(100, 30)).toEqual({rootWidth: 100, rootHeight: 30, bodyWidth: 100, listWidth: 33, actionWidth: 66});
});

it('parses SGR mouse wheel events', () => {
	expect(getMouseWheelDelta('\u001B[<64;10;5M')).toBe(-1);
	expect(getMouseWheelDelta('\u001B[<65;10;5M')).toBe(1);
	expect(getMouseWheelDelta('\u001B[<65;10;5M\u001B[<65;10;5M')).toBe(2);
	expect(getMouseWheelDelta('x')).toBe(0);
});

it('renders one fullscreen frame for each responsive layout', () => {
	const model = createModel();
	for (const windowSizeOverride of [
		{columns: 8, rows: 4},
		{columns: 30, rows: 8},
		{columns: 90, rows: 30},
		{columns: 90, rows: 40},
		{columns: 120, rows: 30},
	]) {
		const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={windowSizeOverride} />);
		expect((lastFrame() ?? '').split('\n')).toHaveLength(windowSizeOverride.rows);
	}
});

it('debounces rerenders from window size changes after the initial frame', async () => {
	vi.useFakeTimers();
	let unmount: (() => void) | undefined;
	try {
		const model = createModel();
		const actions = makeFakeActions(model);
		const rendered = render(
			<App initialModel={model} actions={actions} windowSizeOverride={{columns: 120, rows: 30}} resizeDebounceMs={100} />,
		);
		const {lastFrame, rerender} = rendered;
		unmount = rendered.unmount;
		expect(lastFrame()).toContain('Repo: reclaim-the-forest');

		rerender(<App initialModel={model} actions={actions} windowSizeOverride={{columns: 8, rows: 4}} resizeDebounceMs={100} />);
		expect(lastFrame()).toContain('Repo: reclaim-the-forest');
		expect(lastFrame()).not.toContain('A:feat/a');

		vi.advanceTimersByTime(100);
		await vi.runOnlyPendingTimersAsync();
		const inputSettled = waitForInput();
		vi.advanceTimersByTime(10);
		await inputSettled;

		expect(lastFrame()).toContain('A:feat/a');
	} finally {
		unmount?.();
		vi.useRealTimers();
	}
});

it('coalesces live stdout resize events before rendering the app shell', async () => {
	vi.useFakeTimers();
	let unmount: (() => void) | undefined;
	try {
		const model = createModel();
		const actions = makeFakeActions(model);
		const rendered = render(<App initialModel={model} actions={actions} resizeDebounceMs={100} />);
		const {lastFrame, stdout} = rendered;
		unmount = rendered.unmount;
		let columns = 120;
		let rows = 30;
		Object.defineProperty(stdout, 'columns', {configurable: true, get: () => columns});
		Object.defineProperty(stdout, 'rows', {configurable: true, get: () => rows});
		expect(lastFrame()).toContain('Repo: reclaim-the-forest');

		const frameCountBeforeResize = stdout.frames.length;
		for (const [nextColumns, nextRows] of [[8, 4], [120, 30], [8, 4]] as const) {
			columns = nextColumns;
			rows = nextRows;
			stdout.emit('resize');
		}

		expect(stdout.frames).toHaveLength(frameCountBeforeResize);
		expect(lastFrame()).toContain('Repo: reclaim-the-forest');
		expect(lastFrame()).not.toContain('A:feat/a');

		vi.advanceTimersByTime(100);
		await vi.runOnlyPendingTimersAsync();
		const inputSettled = waitForInput();
		vi.advanceTimersByTime(10);
		await inputSettled;

		expect(lastFrame()).toContain('A:feat/a');
	} finally {
		unmount?.();
		vi.useRealTimers();
	}
});

it('switches to stacked and minimal layouts at the expected breakpoints', () => {
	expect(shouldUseMinimalLayout(8, 4)).toBe(true);
	expect(shouldUseMinimalLayout(30, 8)).toBe(true);
	expect(shouldUseMinimalLayout(30, 12)).toBe(false);
	expect(shouldUseCompactLayout(30, 8, 1)).toBe(false);
	expect(shouldUseCompactLayout(50, 16, 10)).toBe(false);
	expect(shouldUseCompactLayout(72, 20, 10)).toBe(false);
	expect(shouldUseCompactLayout(90, 22, 3)).toBe(false);
	expect(shouldUseCompactLayout(30, 30, 1)).toBe(false);
	expect(shouldUseCompactLayout(120, 30, 3)).toBe(false);
	expect(shouldStackPanes(90, 22, 3)).toBe(false);
	expect(shouldStackPanes(90, 23, 3)).toBe(true);
	expect(shouldStackPanes(90, 24, 3)).toBe(true);
	expect(shouldStackPanes(120, 40, 3)).toBe(false);
});

it('stacks the worktree and selection panes once the terminal is narrow enough', () => {
	const model = createModel();
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 90, rows: 30}} />,
	);

	const frame = lastFrame() ?? '';
	const lines = frame.split('\n');
	const worktreesLine = lines.findIndex(line => line.includes('Worktrees'));
	const selectionLine = lines.findIndex(line => line.includes('Selection / Action'));
	expect(worktreesLine).toBeGreaterThanOrEqual(0);
	expect(selectionLine).toBeGreaterThan(worktreesLine + 1);
});

it('renders colored pane labels and active marker in the main layout', () => {
	const model = createModel();
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />,
	);
	expect(lastFrame()).toContain('Repo: reclaim-the-forest');
	expect(lastFrame()).toContain('ℹ Idle · feat/a — ready');
	expect(lastFrame()).not.toContain('Namespace:');
	expect(lastFrame()).toContain('Worktrees');
	expect(lastFrame()).toContain('Selection / Action');
	expect(lastFrame()).toContain('Idle');
	expect(lastFrame()).toContain('/ Filter');
	expect(lastFrame()).not.toContain('PageUp');
	expect(stripAnsi(lastFrame())).toContain('*   feat/a');
});

it('renders setup in the primary key hints only when setup is available', () => {
	const disabled = createModel({setupAvailable: false});
	const enabled = createModel({setupAvailable: true});

	expect(render(
		<App initialModel={disabled} actions={makeFakeActions(disabled)} windowSizeOverride={{columns: 140, rows: 30}} />,
	).lastFrame()).not.toContain('i Setup');
	expect(render(
		<App initialModel={enabled} actions={makeFakeActions(enabled)} windowSizeOverride={{columns: 140, rows: 30}} />,
	).lastFrame()).toContain('/ Filter | i Setup | e Editor');
});

it('hides editor hints when no editor command is configured', () => {
	const model = createModel({editorAvailable: false});
	const frame = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 140, rows: 30}} />,
	).lastFrame() ?? '';

	expect(frame).not.toContain('e Editor');
	expect(frame).toContain('o Open PR');
});

it('ignores the hidden editor shortcut when no editor command is configured', async () => {
	const model = createModel({editorAvailable: false});
	const openEditor = vi.fn(async () => model);
	const {stdin} = render(
		<App initialModel={model} actions={{...makeFakeActions(model), openEditor}} windowSizeOverride={{columns: 140, rows: 30}} />,
	);

	stdin.write('e');
	await waitForInput();
	expect(openEditor).not.toHaveBeenCalled();
});

it('opens and closes detailed key help', async () => {
	const model = createModel({setupAvailable: true});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />,
	);

	stdin.write('?');
	await waitForInput();
	expect(lastFrame()).toContain('Keyboard Help');
	expect(lastFrame()).toContain('Movement');
	expect(lastFrame()).toContain('g/G');
	expect(lastFrame()).toContain('first/last');
	expect(lastFrame()).toContain('PageUp/PageDn');
	expect(lastFrame()).toContain('selection page');
	expect(lastFrame()).toContain('i');
	expect(lastFrame()).toContain('setup selected worktree');

	stdin.write('q');
	await waitForInput();
	expect(lastFrame()).toContain('Worktrees');
	expect(lastFrame()).not.toContain('Keyboard Help');
});


it('opens key help over the log overlay and returns to logs when closed', async () => {
	const model = createModel();
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />,
	);

	stdin.write('L');
	await waitForInput();
	expect(lastFrame()).toContain('full screen');

	stdin.write('?');
	await waitForInput();
	expect(lastFrame()).toContain('Keyboard Help');

	stdin.write('?');
	await waitForInput();
	expect(lastFrame()).toContain('full screen');
	expect(lastFrame()).not.toContain('Keyboard Help');
});

it('closes key help with escape', async () => {
	const model = createModel();
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />,
	);

	stdin.write('?');
	await waitForInput();
	expect(lastFrame()).toContain('Keyboard Help');

	stdin.write('\u001B');
	await new Promise(resolve => setTimeout(resolve, 30));
	expect(lastFrame()).toContain('Worktrees');
	expect(lastFrame()).not.toContain('Keyboard Help');
});

it('ignores mouse wheel scrolling while key help is open', async () => {
	const model = createModel({
		logs: [{
			name: 'feat-a.log',
			path: '/repo/.git/worktree-command-tui/logs/feat-a.log',
			content: Array.from({length: 40}, (_, index) => `line ${index + 1}`).join('\n'),
		}],
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />,
	);

	stdin.write('?');
	await waitForInput();
	stdin.write('\u001B[<64;10;20M\u001B[<64;10;20M\u001B[<64;10;20M');
	await waitForInput();
	stdin.write('?');
	await waitForInput();
	stdin.write('L');
	await waitForInput();

	expect(lastFrame()).toContain('line 40');
});
it('keeps the pane layout on narrow terminals when vertical space is available', () => {
	const model = createModel();
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 70, rows: 30}} />,
	);
	expect(lastFrame()).toContain('Worktrees');
	expect(lastFrame()).toContain('Selection');
	expect(lastFrame()).not.toContain('Resize terminal for split view');
});

it('keeps the selection pane width stable across selected worktrees', () => {
	const shortModel = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
		],
		activePath: null,
		activeBranch: null,
	});
	const longModel = createModel({
		rows: [
			{
				path: '/repo/.worktree/long',
				shortPath: '.worktree/long',
				branch: 'feature/this-is-a-very-long-branch-name-that-should-not-move-the-pane',
				tags: [],
			},
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
		],
		activePath: null,
		activeBranch: null,
	});
	const shortFrame = render(<App initialModel={shortModel} actions={makeFakeActions(shortModel)} windowSizeOverride={{columns: 120, rows: 30}} />).lastFrame() ?? '';
	const longFrame = render(<App initialModel={longModel} actions={makeFakeActions(longModel)} windowSizeOverride={{columns: 120, rows: 30}} />).lastFrame() ?? '';
	const shortTitleLine = shortFrame.split('\n').find(line => line.includes('Selection / Action')) ?? '';
	const longTitleLine = longFrame.split('\n').find(line => line.includes('Selection / Action')) ?? '';
	expect(shortTitleLine.indexOf('Selection / Action')).toBe(longTitleLine.indexOf('Selection / Action'));
});

it('stacks panes responsively on medium-width terminals when there is enough vertical space', () => {
	const model = createModel();
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 90, rows: 40}} />,
	);
	expect(lastFrame()).toContain('Worktrees');
	expect(lastFrame()).toContain('Selection / Action');
	expect(stripAnsi(lastFrame())).toContain('> -   develop [root]');
});

it('shows logs while keeping stacked worktree rows on tall narrow terminals', () => {
	const model = createModel({
		rows: Array.from({length: 6}, (_, index) => ({
			path: `/repo/.worktree/item-${index}`,
			shortPath: `.worktree/item-${index}`,
			branch: `item-${index}`,
			tags: index === 0 ? ['active'] : [],
		})),
		activePath: '/repo/.worktree/item-0',
		activeBranch: 'item-0',
	});
	const columns = 90;
	const rows = 40;
	expect(shouldStackPanes(columns, rows, model.rows.length)).toBe(true);
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns, rows}} />,
	);
	const lines = stripAnsi(lastFrame() ?? '').split('\n');
	expect(lines.join('\n')).toContain('Logs (*.log · tail 120)');
	const worktreesHeader = lines.findIndex(line => line.includes('Worktrees'));
	const selectionHeader = lines.findIndex((line, index) => index > worktreesHeader && line.includes('Selection / Action'));
	expect(worktreesHeader).toBeGreaterThan(-1);
	expect(selectionHeader).toBeGreaterThan(worktreesHeader + 1);
	const worktreeSection = lines.slice(worktreesHeader, selectionHeader);
	const visibleWorktreeRows = worktreeSection.filter(line => /\bitem-\d+\b/.test(line));
	expect(visibleWorktreeRows.length).toBeGreaterThan(3);
});



it('shows the log pane on tall split terminals', () => {
	const model = createModel();
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 40}} />,
	);
	expect(lastFrame()).toContain('Logs (*.log · tail 120)');
	expect(lastFrame()).toContain('server started');
});

it('opens and closes the full-screen log view with L', async () => {
	const model = createModel();
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 40}} />,
	);
	expect(lastFrame()).not.toContain('Logs (*.log · tail 120 · full screen)');
	stdin.write('L');
	await waitForInput();
	expect(lastFrame()).toContain('Logs (*.log · tail 120 · full screen)');
	stdin.write('q');
	await waitForInput();
	expect(lastFrame()).not.toContain('Logs (*.log · tail 120 · full screen)');
});

it('scrolls the log pane through the tailed lines', async () => {
	const model = createModel({
		logs: [{
			name: 'feat-a.log',
			path: '/repo/.git/worktree-command-tui/logs/feat-a.log',
			content: Array.from({length: 12}, (_, index) => `row-${String(index + 1).padStart(2, '0')}`).join('\n'),
		}],
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 40}} />,
	);
	expect(lastFrame()).toContain('row-12');
	expect(lastFrame()).not.toContain('row-01');
	stdin.write('[');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('row-04');
	expect(lastFrame()).toContain('row-09');
	expect(lastFrame()).not.toContain('row-12');
	stdin.write(']');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('row-12');
});

it('scrolls the full-screen log view with keyboard controls', async () => {
	const model = createModel({
		logs: [{
			name: 'feat-a.log',
			path: '/repo/.git/worktree-command-tui/logs/feat-a.log',
			content: Array.from({length: 20}, (_, index) => `wide-${String(index + 1).padStart(2, '0')}`).join('\n'),
		}],
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 40}} />,
	);
	stdin.write('L');
	await waitForInput();
	expect(lastFrame()).toContain('wide-20');
	stdin.write('[');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('wide-08');
	stdin.write('G');
	await waitForInput();
	expect(lastFrame()).toContain('wide-20');
});

it('refreshes logs in near real time while running', async () => {
	const initialModel = createModel({status: {kind: 'running', message: 'started feat/a'}});
	const refreshedLogs = [{
		name: 'feat-a.log',
		path: '/repo/.git/worktree-command-tui/logs/feat-a.log',
		content: 'ready\nserver started\nnew output',
	}];
	const actions = {
		...makeFakeActions(initialModel),
		refreshLogs: vi.fn(async () => ({logs: refreshedLogs, activePath: initialModel.activePath, activeBranch: initialModel.activeBranch})),
	};
	const {lastFrame} = render(
		<App initialModel={initialModel} actions={actions} windowSizeOverride={{columns: 120, rows: 40}} />,
	);
	await new Promise(resolve => setTimeout(resolve, 450));
	await waitForInput();
	expect(actions.refreshLogs).toHaveBeenCalled();
	expect(lastFrame()).toContain('new output');
});

it('getModelAfterLogRefresh returns the same model for unchanged log refreshes', () => {
	const model = createModel({status: {kind: 'running', message: 'Active: feat/a'}});
	const result = getModelAfterLogRefresh(model, {
		logs: model.logs.map(log => ({...log})),
		activePath: model.activePath,
		activeBranch: model.activeBranch,
	});

	expect(result).toBe(model);
});

it('getModelAfterLogRefresh applies changed logs and stale session liveness', () => {
	const model = createModel({status: {kind: 'running', message: 'Active: feat/a'}});
	const result = getModelAfterLogRefresh(model, {
		logs: [{name: 'feat-a.log', path: '/repo/.git/worktree-command-tui/logs/feat-a.log', content: 'ready\nserver stopped'}],
		activePath: null,
		activeBranch: null,
	});

	expect(result).not.toBe(model);
	expect(result.status).toEqual({kind: 'idle', message: 'session ended'});
	expect(result.activePath).toBeNull();
	expect(result.rows.some(row => row.tags.includes('active'))).toBe(false);
});

it('clears stale running state when log refresh observes no active session', async () => {
	const initialModel = createModel({status: {kind: 'running', message: 'Active: feat/a'}});
	const actions = {
		...makeFakeActions(initialModel),
		refreshLogs: vi.fn(async () => ({logs: initialModel.logs, activePath: null, activeBranch: null})),
	};
	const {lastFrame} = render(
		<App initialModel={initialModel} actions={actions} windowSizeOverride={{columns: 120, rows: 40}} />,
	);

	await new Promise(resolve => setTimeout(resolve, 450));
	await waitForInput();
	expect(actions.refreshLogs).toHaveBeenCalled();
	expect(lastFrame()).toContain('ℹ Idle');
	expect(lastFrame()).toContain('session ended');
	expect(lastFrame()).not.toContain('Running:');
});

it('does not poll full worktree metadata while running', async () => {
	vi.useFakeTimers();
	let unmount: (() => void) | undefined;
	try {
		const initialModel = createModel({status: {kind: 'running', message: 'started feat/a'}});
		const actions = makeFakeActions(initialModel);
		({unmount} = render(
			<App initialModel={initialModel} actions={actions} windowSizeOverride={{columns: 120, rows: 40}} />,
		));

		vi.advanceTimersByTime(1650);
		expect(actions.refresh).not.toHaveBeenCalled();
	} finally {
		unmount?.();
		vi.useRealTimers();
	}
});
it('uses split layout when the stacked breakpoint no longer applies', () => {
	const manyRows: AppModel['rows'] = Array.from({length: 10}, (_, index) => ({
		path: `/repo/.worktree/feat-${index}`,
		shortPath: `.worktree/feat-${index}`,
		branch: `feat/${index}`,
		tags: (index === 0 ? ['active'] : []) as RowTag[],
		pullRequest: index === 0 ? {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'} : undefined,
	}));
	const model = createModel({rows: manyRows, activePath: '/repo/.worktree/feat-0', activeBranch: 'feat/0'});
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 96, rows: 26}} />,
	);
	expect(lastFrame()).toContain('[Action]');
	expect(lastFrame()).not.toContain('Full Path:');
	expect(lastFrame()).not.toContain('Tags:');
	expect(lastFrame()).not.toContain('PR Title:');
});
it('keeps rich detail rows on medium split terminals', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: ['active'],
			headSha: '46af3f1c',
			branchCreatedAtMs: Date.UTC(2026, 5, 5, 12, 34, 56),
			upstream: {branch: 'origin/develop', ahead: 4, behind: 24},
			workingTree: {staged: 1, unstaged: 0, untracked: 0, conflicts: 0},
			pullRequest: {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'},
		}] as AppModel['rows'],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
	});
	const {lastFrame} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 100, rows: 30}} />,
	);
	expect(lastFrame()).toContain('Full Path: /repo/.worktree/feat-a');
	expect(lastFrame()).toContain('Branch Created: 2026-06-05 12:34:56 UTC');
	expect(lastFrame()).not.toContain('ACTIVE');
	expect(lastFrame()).toContain('PR Title: Selection pane metadata');

});

it('scrolls selection details when the pane is height constrained', async () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: ['active'],
			headSha: '46af3f1c',
			upstream: {branch: 'origin/develop', ahead: 4, behind: 24},
			workingTree: {staged: 1, unstaged: 2, untracked: 3, conflicts: 0},
			pullRequest: {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'},
		}] as AppModel['rows'],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 100, rows: 11}} />,
	);
	expect(lastFrame()).toContain('[Identity]');
	expect(lastFrame()).toContain('█');
	expect(lastFrame()).not.toContain('Full Path: /repo/.worktree/feat-a');
	stdin.write('\u001B[6~');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('Full Path: /repo/.worktree/feat-a');
});

it('scrolls selection details with SGR mouse wheel input', async () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: ['active'],
			headSha: '46af3f1c',
			upstream: {branch: 'origin/develop', ahead: 4, behind: 24},
			workingTree: {staged: 1, unstaged: 2, untracked: 3, conflicts: 0},
			pullRequest: {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'},
		}] as AppModel['rows'],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 100, rows: 11}} />,
	);
	expect(lastFrame()).not.toContain('Full Path: /repo/.worktree/feat-a');
	stdin.write('\u001B[<65;80;10M');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('Full Path: /repo/.worktree/feat-a');
});

it('scrolls worktree list with SGR mouse wheel input', async () => {
	const model = createModel({
		rows: Array.from({length: 12}, (_, index) => ({
			path: `/repo/.worktree/feat-${index}`,
			shortPath: `.worktree/feat-${index}`,
			branch: `feat-${index}`,
			tags: index === 0 ? ['active'] : [],
		})),
		activePath: '/repo/.worktree/feat-0',
		activeBranch: 'feat-0',
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 100, rows: 16}} />,
	);
	expect(stripAnsi(lastFrame())).not.toContain('feat-8');
	expect(stripAnsi(lastFrame())).toContain('│ > *   feat-0');
	stdin.write('\u001B[<65;1;6M');
	await waitForInput();
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('│   -   feat-3');
	expect(stripAnsi(lastFrame())).not.toContain('│ > -   feat-0');
});

it('scrolls selection details with SGR mouse wheel in tall split layout', async () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: ['active', 'main', 'external', 'legacy'],
			headSha: '46af3f1c',
			upstream: {branch: 'origin/develop', ahead: 4, behind: 24},
			workingTree: {staged: 1, unstaged: 2, untracked: 3, conflicts: 0},
			pullRequest: {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'},
		}] as AppModel['rows'],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
		logs: [{name: 'feat-a.log', path: '/tmp/feat-a.log', content: 'a\nb\nc\nd\ne\nf\ng'}],
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 34}} />,
	);
	expect(lastFrame()).not.toContain('Already active. Press Enter to restart, or s to stop.');
	stdin.write(`\u001B[<65;${getShellDimensions(120, 34).listWidth + 2};6M`);
	await waitForInput();
	await waitForInput();
	stdin.write(`\u001B[<65;${getShellDimensions(120, 34).listWidth + 2};6M`);
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('Already active. Press Enter to restart, or s to stop.');
});

it('scrolls the log pane with SGR mouse wheel input', async () => {
	const model = createModel({
		logs: [{
			name: 'feat-a.log',
			path: '/repo/.git/worktree-command-tui/logs/feat-a.log',
			content: Array.from({length: 12}, (_, index) => `row-${String(index + 1).padStart(2, '0')}`).join('\n'),
		}],
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 40}} />,
	);
	expect(lastFrame()).toContain('row-12');
	stdin.write('\u001B[<64;80;36M');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('row-04');
	expect(lastFrame()).not.toContain('row-12');
});

it('routes stacked-layout mouse wheel input by pane position', async () => {
	const rows: AppModel['rows'] = [
		{
			path: '/repo/.worktree/feat-0',
			shortPath: '.worktree/feat-0',
			branch: 'feat-0',
			tags: ['active'],
			headSha: '46af3f1c',
			upstream: {branch: 'origin/develop', ahead: 4, behind: 24},
			workingTree: {staged: 1, unstaged: 2, untracked: 3, conflicts: 0},
			pullRequest: {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'},
		},
		...Array.from({length: 11}, (_, index) => ({
			path: `/repo/.worktree/feat-${index + 1}`,
			shortPath: `.worktree/feat-${index + 1}`,
			branch: `feat-${index + 1}`,
			tags: [] as RowTag[],
		})),
	];
	const model = createModel({
		rows,
		activePath: '/repo/.worktree/feat-0',
		activeBranch: 'feat-0',
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 90, rows: 30}} />,
	);
	expect(stripAnsi(lastFrame())).not.toContain('feat-10');
	expect(lastFrame()).not.toContain('PR Title: Selection pane metadata');
	stdin.write('\u001B[<65;10;6M');
	await waitForInput();
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('feat-3');
	expect(lastFrame()).not.toContain('PR Title: Selection pane metadata');
	stdin.write('\u001B[<65;10;18M');
	await waitForInput();
	await waitForInput();
	stdin.write('\u001B[<65;10;18M');
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('PR Title: Selection pane metadata');
});

it('ignores mouse wheel input over header and footer chrome', async () => {
	const model = createModel({
		rows: Array.from({length: 12}, (_, index) => ({
			path: `/repo/.worktree/feat-${index}`,
			shortPath: `.worktree/feat-${index}`,
			branch: `feat-${index}`,
			tags: index === 0 ? ['active'] : [],
		})),
		activePath: '/repo/.worktree/feat-0',
		activeBranch: 'feat-0',
	});
	const {lastFrame, stdin} = render(
		<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 100, rows: 16}} />,
	);
	const initialFrame = stripAnsi(lastFrame() ?? '');
	stdin.write('\u001B[<65;10;1M');
	await waitForInput();
	await waitForInput();
	stdin.write('\u001B[<65;10;16M');
	await waitForInput();
	await waitForInput();
	expect(stripAnsi(lastFrame() ?? '')).toBe(initialFrame);
});

it('renders a minimal fallback shell on very short terminals', () => {
	const model = createModel({rows: [{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']}], activePath: '/repo', activeBranch: 'develop'});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 30, rows: 8}} />);
	expect(lastFrame()).toContain('A:develop');
	expect(lastFrame()).toContain('S:develop');
	expect(lastFrame()).toContain('T:idle');
	expect(lastFrame()).toContain('↑↓jk/↵eodLq');
});

it('shows setup shortcut in the minimal shell only when setup is configured', () => {
	const base = createModel({rows: [{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']}], activePath: '/repo', activeBranch: 'develop'});
	const withoutSetup = render(<App initialModel={base} actions={makeFakeActions(base)} windowSizeOverride={{columns: 30, rows: 8}} />);
	expect(withoutSetup.lastFrame()).toContain('↑↓jk/↵eodLq');

	const withSetup = createModel({...base, setupAvailable: true});
	const withSetupRender = render(<App initialModel={withSetup} actions={makeFakeActions(withSetup)} windowSizeOverride={{columns: 30, rows: 8}} />);
	expect(withSetupRender.lastFrame()).toContain('↑↓jk/↵ieodLq');
});

it('shows delete confirmation in the minimal layout', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame, stdin} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 18, rows: 8}} />);
	stdin.write('d');
	await waitForInput();
	expect(lastFrame()).toContain('D:Delete feat/a?');
	expect(lastFrame()).toContain('d/y confirm');
});

it('shows completion alert after starting a worktree', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const completed = {
		...model,
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
		status: {kind: 'running', message: 'started feat/a'},
	} as const;
	const {lastFrame, stdin} = render(
		<App
			initialModel={model}
			actions={{
				...makeFakeActions(model),
				start: vi.fn(async () => completed),
			}}
			windowSizeOverride={{columns: 80, rows: 22}}
		/>,
	);
	stdin.write('\r');
	await vi.waitFor(() => expect(lastFrame()).toContain('Switched to feat/a'));
});

it('renders a minimal fallback shell on extremely small terminals', () => {
	const model = createModel({rows: [{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']}], activePath: '/repo', activeBranch: 'develop'});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 8, rows: 4}} />);
	expect(lastFrame()).toContain('A:devel…');
	expect(lastFrame()).toContain('S:devel…');
	expect(lastFrame()).toContain('T:idle');
	expect(lastFrame()).toContain('↑↓jk/↵e…');
});

it('sanitizes branch and status text in the minimal fallback shell', () => {
	const model = createModel({
		rows: [{path: '/repo', shortPath: '.', branch: 'feat/\u001b[2Jbad\u202E', tags: ['main']}],
		activePath: '/repo',
		activeBranch: 'feat/\u001b]0;owned\u0007active\u202E',
		status: {kind: 'error', message: 'bad\u001b]0;owned\u0007\nstatus\u202E'},
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 30, rows: 4}} />);
	expect(lastFrame()).toContain('A:feat/active');
	expect(lastFrame()).toContain('S:feat/bad');
	expect(lastFrame()).not.toContain('\u001b');
	expect(lastFrame()).not.toContain('owned');
	expect(lastFrame()).not.toContain('\u202E');
});


it('keeps the active branch visible when header metadata is long', () => {
	const model = createModel({
		repoName: 'reclaim-the-forest-with-a-long-name',
		namespace: 'rojo-serve-with-a-long-namespace',
		rows: [{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']}],
		activePath: '/repo',
		activeBranch: 'feature/this-is-a-very-long-branch-name-that-should-still-be-visible',
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('Idle · feature/this-is-a-very-long-branch-name-that-should-still-be-visible');
});

it('truncates long branch labels in the worktree pane', () => {
	const model = createModel({
		rows: [{path: '/repo/long', shortPath: '.worktree/long', branch: 'feature/this-is-a-very-long-branch-name-that-wraps', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	const branchLine = stripAnsi(lastFrame()).split('\n').find(line => line.includes('feature/this-is-a-very-long-')) ?? '';
	expect(branchLine).toContain('feature/this-is-a-very-long-');
	expect(branchLine).toContain('…');
	expect(branchLine).not.toContain('feature/this-is-a-very-long-branch-name-that-wraps');
});

it('wraps long values in the selection pane', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feature/this/is/a/very/long/path/that/keeps/going/until/the/panel/would/wrap',
			shortPath: '.worktree/feature/long',
			branch: 'feature/this-is-a-very-long-branch-name-that-wraps-and-keeps-going-past-the-panel-width',
			headSha: '46af3f1c',
			headCommit: {message: 'Render the complete commit summary even when the selection pane is narrow'},
			tags: [],
		}],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	const frame = lastFrame() ?? '';
	expect(frame).toContain('Path: .worktree/feature/long');
	const compactFrame = stripAnsi(frame).replace(/[\s│╭╮╰╯─]/gu, '');
	expect(compactFrame).toContain('Branch:feature/this-is-a-very-long-branch-name-that-wraps-and-keeps-going-past-the-panel-width');
	expect(compactFrame).toContain('FullPath:/repo/.worktree/feature/this/is/a/very/long/path/that/keeps/going/until/the/panel/would/wrap');
	expect(compactFrame).toContain('HEAD:46af3f1cRenderthecompletecommitsummaryevenwhentheselectionpaneisnarrow');
});
it('shows git and PR metadata in the selection pane', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: ['active'],
			headSha: '46af3f1c',
			upstream: {branch: 'origin/develop', ahead: 4, behind: 24},
			workingTree: {staged: 1, unstaged: 2, untracked: 3, conflicts: 0},
			pullRequest: {kind: 'found', number: 2125, title: 'Selection pane metadata', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: true, baseBranch: 'develop'},
		}] as AppModel['rows'],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('[Identity]');
	expect(lastFrame()).toContain('Path: .worktree/feat-a');
	expect(lastFrame()).toContain('HEAD: 46af3f1c');
	expect(lastFrame()).toContain('[Git / PR]');
	expect(lastFrame()).toContain('Upstream: origin/develop (↑4 ↓24)');
	expect(lastFrame()).toContain('Status: dirty (index 1 · worktree 2 · untracked 3)');
	expect(lastFrame()).toContain('PR: #2125 draft/open → develop');
	expect(lastFrame()).toContain('PR Title: Selection pane metadata');
	expect(lastFrame()).toContain('[Action]');
	expect(lastFrame()).toContain('Already active. Press Enter to restart, or s to stop.');
});
it('shows unavailable metadata when git or gh inspection fails', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: [],
			upstreamUnavailable: true,
			pullRequest: {kind: 'unavailable'},
		}] as AppModel['rows'],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('Upstream: unavailable');
	expect(lastFrame()).toContain('Status: unavailable');
	expect(lastFrame()).toContain('PR: unavailable');
});
it('keeps no-upstream metadata distinct from unavailable metadata', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: [],
			workingTree: {staged: 0, unstaged: 0, untracked: 0, conflicts: 0},
			pullRequest: {kind: 'none'},
		}] as AppModel['rows'],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('Upstream: -');
	expect(lastFrame()).toContain('Status: clean');
	expect(lastFrame()).toContain('PR: none');
});
it('labels historical PR metadata explicitly', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: [],
			pullRequest: {kind: 'found', number: 2001, title: 'Already merged', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2001', state: 'MERGED', isDraft: false, baseBranch: 'develop'},
		}] as AppModel['rows'],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('Last PR: #2001 merged → develop');
	expect(lastFrame()).toContain('Last PR Title: Already merged');
});
it('sanitizes PR titles before rendering them into the terminal', () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a \u2066next',
			shortPath: '.worktree/feat-a \u2066next',
			branch: 'feat/\u202Ebad',
			tags: [],
			upstream: {branch: 'origin/devel\u2028op', ahead: 1, behind: 2},
			pullRequest: {kind: 'found', number: 2125, title: 'bad\nline\u001b[2J\u2028more \u202Ertl', url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125', state: 'OPEN', isDraft: false, baseBranch: 'devel\u2066op'},
		}] as AppModel['rows'],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('Branch: feat/bad');
	expect(lastFrame()).toContain('Path: .worktree/feat-a next');
	expect(lastFrame()).toContain('Full Path: /repo/.worktree/feat-a next');
	expect(lastFrame()).toContain('Upstream: origin/devel op (↑1 ↓2)');
	expect(lastFrame()).toContain('PR: #2125 open → develop');
	expect(lastFrame()).toContain('PR Title: bad line more rtl');
	expect(lastFrame()).not.toContain('\u001b');
	expect(lastFrame()).not.toContain('\u202e');
	expect(lastFrame()).not.toContain('\u2066');
});

it('shows invalid reason in the detail pane before start is attempted', () => {
	const model = createModel({
		rows: [{path: '/bad', shortPath: '/bad', branch: 'fix/bad', tags: ['invalid'], invalidReason: 'Missing required files: default.project.json'}],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	expect(lastFrame()).toContain('[Notes]');
	expect(lastFrame()).toContain('Missing required files: default.project.json');
});

it('supports vim-style movement keys', async () => {
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: []},
		],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame, stdin} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('j');
	await waitForInput();
	expect(lastFrame()).toContain('Branch: feat/a');
	stdin.write('G');
	await waitForInput();
	expect(lastFrame()).toContain('Branch: feat/b');
	stdin.write('g');
	await waitForInput();
	expect(lastFrame()).toContain('Branch: develop');
	stdin.write('j');
	await waitForInput();
	stdin.write('k');
	await waitForInput();
	expect(lastFrame()).toContain('Branch: develop');
});

it('wraps selection around the worktree list boundaries', async () => {
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: []},
		],
		activePath: null,
		activeBranch: null,
	});
	const {lastFrame, stdin} = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);

	expect(stripAnsi(lastFrame())).toContain('Branch: develop');

	stdin.write('k');
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('Branch: feat/b');

	stdin.write('j');
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('Branch: develop');

	stdin.write('j');
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('Branch: feat/a');

	stdin.write('j');
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('Branch: feat/b');

	stdin.write('j');
	await waitForInput();
	expect(stripAnsi(lastFrame())).toContain('Branch: develop');
});


it('filters worktrees by branch, path, and pull request metadata', async () => {
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feature-login', shortPath: '.worktree/feature-login', branch: 'feat/login', tags: []},
			{
				path: '/repo/.worktree/bugfix',
				shortPath: '.worktree/bugfix',
				branch: 'fix/auth',
				tags: [],
				pullRequest: {
					kind: 'found',
					number: 24,
					title: 'Add searchable worktree list',
					url: 'https://github.com/ohzw/worktree-command-tui/pull/24',
					state: 'OPEN',
					isDraft: false,
					baseBranch: 'main',
				},
			},
		],
		activePath: null,
		activeBranch: null,
	});
	const firstRender = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);

	firstRender.stdin.write('/');
	await waitForInput();
	expect(stripAnsi(firstRender.lastFrame())).toContain('Worktrees /█ (3/3)');
	firstRender.stdin.write('LOGIN');
	await waitForInput();
	expect(stripAnsi(firstRender.lastFrame())).toContain('Worktrees /LOGIN█ (1/3)');
	expect(firstRender.lastFrame()).toContain('Branch: feat/login');
	expect(stripAnsi(firstRender.lastFrame())).not.toContain('fix/auth');
	firstRender.unmount();

	const secondRender = render(<App initialModel={model} actions={makeFakeActions(model)} windowSizeOverride={{columns: 120, rows: 30}} />);
	secondRender.stdin.write('/');
	await waitForInput();
	secondRender.stdin.write('searchable');
	await waitForInput();
	expect(secondRender.lastFrame()).toContain('Branch: fix/auth');
});

it('keeps movement and actions scoped to filtered worktrees', async () => {
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: []},
		],
		activePath: null,
		activeBranch: null,
	});
	const start = vi.fn(async () => model);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);

	stdin.write('/');
	await waitForInput();
	stdin.write('feat');
	await waitForInput();
	expect(lastFrame()).toContain('Branch: feat/a');
	stdin.write('\u001B[B');
	await waitForInput();
	expect(lastFrame()).toContain('Branch: feat/b');
	stdin.write('\r');
	await waitForInput();
	expect(start).toHaveBeenCalledWith('/repo/.worktree/feat-b');
});

it('shows an explicit empty filter result and restores selection when cleared', async () => {
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
		],
		activePath: null,
		activeBranch: null,
	});
	const start = vi.fn(async () => model);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);

	stdin.write('/');
	await waitForInput();
	stdin.write('missing');
	await waitForInput();
	expect(lastFrame()).toContain('No worktrees match filter.');
	expect(lastFrame()).toContain('No worktrees found.');
	stdin.write('\u001B[B');
	stdin.write('\r');
	await waitForInput();
	expect(start).not.toHaveBeenCalled();

	stdin.write('\u001B');
	await new Promise(resolve => setTimeout(resolve, 30));
	expect(lastFrame()).toContain('Branch: develop');
	expect(stripAnsi(lastFrame())).not.toContain('No worktrees match filter.');
});

it('shows invalid reason instead of starting when enter is pressed on invalid worktree', async () => {
	const model = createModel({
		rows: [{path: '/bad', shortPath: '/bad', branch: 'fix/bad', tags: ['invalid'], invalidReason: 'Missing required files: default.project.json'}],
		activePath: null,
		activeBranch: null,
	});
	const start = vi.fn();
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('\r');
	await waitForInput();
	expect(start).not.toHaveBeenCalled();
	expect(lastFrame()).toContain('Missing required files: default.project.json');
});

it('refreshes full worktree metadata only when requested', async () => {
	const model = createModel({
		status: {kind: 'running', message: 'Active: feat/a'},
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: ['active']}],
	});
	const refreshed = createModel({
		status: {kind: 'running', message: 'Active: feat/a'},
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: ['active'],
			pullRequest: {
				kind: 'found',
				number: 42,
				title: 'Manual refresh PR metadata',
				url: 'https://github.com/acme/worktree-command-tui/pull/42',
				state: 'OPEN',
				isDraft: false,
				baseBranch: 'main',
			},
		}],
	});
	const refresh = vi.fn(async () => refreshed);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), refresh}} windowSizeOverride={{columns: 120, rows: 30}} />);

	await waitForInput();
	expect(refresh).not.toHaveBeenCalled();
	stdin.write('r');
	await waitForInput();
	await waitForInput();
	expect(refresh).toHaveBeenCalledTimes(1);
	expect(lastFrame()).toContain('PR Title: Manual refresh PR metadata');

});

it('ignores stale log refresh liveness after manual full refresh completes', async () => {
	const initial = createModel({
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
		status: {kind: 'running', message: 'Active: feat/a'},
		rows: [
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: ['active']},
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: []},
		],
	});
	const refreshed = createModel({
		activePath: '/repo/.worktree/feat-b',
		activeBranch: 'feat/b',
		status: {kind: 'running', message: 'Active: feat/b'},
		rows: [
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: ['active']},
		],
	});
	const staleLogRefresh = Promise.withResolvers<Awaited<ReturnType<AppActions['refreshLogs']>>>();
	const refreshLogs = vi.fn(() => staleLogRefresh.promise);
	const refresh = vi.fn(async () => refreshed);
	const {lastFrame, stdin} = render(
		<App
			initialModel={initial}
			actions={{...makeFakeActions(initial), refresh, refreshLogs}}
			windowSizeOverride={{columns: 120, rows: 30}}
		/>,
	);

	await vi.waitFor(() => expect(refreshLogs).toHaveBeenCalledTimes(1), {timeout: 1000});
	stdin.write('r');
	await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
	await vi.waitFor(() => expect(lastFrame()).toContain('Running: feat/b'));

	staleLogRefresh.resolve({logs: initial.logs, activePath: initial.activePath, activeBranch: initial.activeBranch});
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('Running: feat/b');
	expect(lastFrame()).not.toContain('Running: feat/a');

});

it('keeps invalid enter feedback when stale log refresh liveness resolves', async () => {
	const invalidReason = 'Missing required files: default.project.json';
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['active', 'main']},
			{path: '/bad', shortPath: '/bad', branch: 'fix/bad', tags: ['invalid'], invalidReason},
		],
		activePath: '/repo',
		activeBranch: 'develop',
		status: {kind: 'running', message: 'Active: develop'},
	});
	const staleLogRefresh = Promise.withResolvers<Awaited<ReturnType<AppActions['refreshLogs']>>>();
	const refreshLogs = vi.fn(() => staleLogRefresh.promise);
	const start = vi.fn();
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), refreshLogs, start}} windowSizeOverride={{columns: 120, rows: 30}} />);

	await vi.waitFor(() => expect(refreshLogs).toHaveBeenCalledTimes(1), {timeout: 1000});
	stdin.write('j');
	await waitForInput();
	stdin.write('\r');
	await waitForInput();
	expect(start).not.toHaveBeenCalled();
	expect(lastFrame()).toContain('✘ Error · develop');
	expect(lastFrame()).toContain(invalidReason);

	staleLogRefresh.resolve({logs: model.logs, activePath: null, activeBranch: null});
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('✘ Error · develop');
	expect(lastFrame()).toContain(invalidReason);
});

it('continues refreshing logs after invalid-row feedback while a session is active', async () => {
	const invalidReason = 'Missing required files: default.project.json';
	const model = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['active', 'main']},
			{path: '/bad', shortPath: '/bad', branch: 'fix/bad', tags: ['invalid'], invalidReason},
		],
		activePath: '/repo',
		activeBranch: 'develop',
		status: {kind: 'running', message: 'Active: develop'},
	});
	const refreshLogs = vi.fn(async () => ({logs: model.logs, activePath: model.activePath, activeBranch: model.activeBranch}));
	const start = vi.fn();
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), refreshLogs, start}} windowSizeOverride={{columns: 120, rows: 30}} />);

	stdin.write('j');
	await waitForInput();
	stdin.write('\r');
	await waitForInput();
	expect(start).not.toHaveBeenCalled();
	expect(lastFrame()).toContain('✘ Error');

	const callsAfterError = refreshLogs.mock.calls.length;
	await vi.waitFor(() => expect(refreshLogs.mock.calls.length).toBeGreaterThan(callsAfterError), {timeout: 1000});
	expect(lastFrame()).toContain(invalidReason);
});




it('keeps the same worktree selected when start reorders the list', async () => {
	const initial = createModel({
		rows: [
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: []},
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
		],
		activePath: null,
		activeBranch: null,
	});
	const reordered = createModel({
		rows: [
			{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']},
			{path: '/repo/.worktree/feat-b', shortPath: '.worktree/feat-b', branch: 'feat/b', tags: ['active']},
			{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []},
		],
		activePath: '/repo/.worktree/feat-b',
		activeBranch: 'feat/b',
		status: {kind: 'running', message: 'started feat/b'},
	});
	const {lastFrame, stdin} = render(<App initialModel={initial} actions={{...makeFakeActions(reordered), start: vi.fn(async () => reordered)}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('\r');
	await waitForInput();
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('Running: feat/b');
	expect(lastFrame()).toContain('Path: .worktree/feat-b');
	expect(lastFrame()).toContain('[Action]');
	expect(lastFrame()).toContain('Already active. Press Enter to restart, or s to stop.');

});

it('continues refreshing logs while active sessions are running', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: ['active']}],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
		status: {kind: 'running', message: 'Active: feat/a'},
	});
	const refreshLogs = vi.fn(async () => ({logs: model.logs, activePath: model.activePath, activeBranch: model.activeBranch}));
	const {lastFrame} = render(<App initialModel={model} actions={{...makeFakeActions(model), refreshLogs}} windowSizeOverride={{columns: 120, rows: 30}} />);

	await new Promise(resolve => setTimeout(resolve, 450));
	await waitForInput();
	expect(refreshLogs).toHaveBeenCalled();
	expect(lastFrame()).toContain('Running: feat/a');
});


it('converts start failures into error status instead of crashing the app', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const start = vi.fn().mockRejectedValue(
		new Error('spawn failed: /tmp/logs/rojo-with-a-very-long-file-name-that-keeps-going-until-it-wraps-across-multiple-columns-and-pushes-the-footer-down.log'),
	);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('\r');
	await waitForInput();
	await waitForInput();
	await waitForInput();
	expect(lastFrame()).toContain('spawn failed: /tmp/logs/rojo-with-a-very-long-file-name-that-keeps-going-until-it-wraps-acro');
});

it('restarts the already-active worktree when enter is pressed', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: ['active']}],
		activePath: '/repo/.worktree/feat-a',
		activeBranch: 'feat/a',
	});
	const restarted = {...model, status: {kind: 'running' as const, message: 'restarted feat/a'}};
	const start = vi.fn(async () => restarted);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('\r');
	await waitForInput();
	expect(start).toHaveBeenCalledWith('/repo/.worktree/feat-a');
	await vi.waitFor(() => expect(lastFrame()).toContain('Running: feat/a — restarted'));
});

it('runs setup command for the selected worktree when i is pressed', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
		setupAvailable: true,
	});
	const setupResult = {...model, status: {kind: 'idle' as const, message: 'setup complete for feat/a'}};
	const setup = vi.fn(async () => setupResult);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), setup}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('i');
	await waitForInput();
	await waitForInput();
	await waitForInput();
	expect(setup).toHaveBeenCalledWith('/repo/.worktree/feat-a');
	expect(lastFrame()).toContain('setup complete for feat/a');
});

it('opens the selected worktree in the configured editor when e is pressed', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const opened = {...model, status: {kind: 'idle' as const, message: 'opened editor for feat/a'}};
	const openEditor = vi.fn(async () => opened);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), openEditor}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('e');
	await waitForInput();
	await waitForInput();
	expect(openEditor).toHaveBeenCalledWith('/repo/.worktree/feat-a');
	expect(lastFrame()).toContain('opened editor for feat/a');
});

it('opens the selected pull request when o is pressed', async () => {
	const model = createModel({
		rows: [{
			path: '/repo/.worktree/feat-a',
			shortPath: '.worktree/feat-a',
			branch: 'feat/a',
			tags: [],
			pullRequest: {
				kind: 'found',
				number: 2125,
				title: 'Selection pane metadata',
				url: 'https://github.com/finn-inc/reclaim-the-forest/pull/2125',
				state: 'OPEN',
				isDraft: false,
				baseBranch: 'develop',
			},
		}],
		activePath: null,
		activeBranch: null,
	});
	const opened = {...model, status: {kind: 'idle' as const, message: 'opened pull request #2125 for feat/a'}};
	const openPullRequest = vi.fn(async () => opened);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), openPullRequest}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('o');
	await waitForInput();
	await waitForInput();
	expect(openPullRequest).toHaveBeenCalledWith('/repo/.worktree/feat-a');
	expect(lastFrame()).toContain('opened pull request #2125 for feat/a');
});

it('cancels delete confirmation without removing the selected worktree', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const deleteWorktree = vi.fn(async () => model);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), deleteWorktree}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('d');
	await waitForInput();
	expect(lastFrame()).toContain('Delete feat/a? d/y confirm, Esc/n/q cancel');
	stdin.write('n');
	await waitForInput();
	expect(deleteWorktree).not.toHaveBeenCalled();
	expect(lastFrame()).not.toContain('Delete feat/a? d/y confirm, Esc/n/q cancel');
});

it('deletes the selected worktree after confirming with y', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const deleted = createModel({
		rows: [{path: '/repo', shortPath: '.', branch: 'develop', tags: ['main']}],
		activePath: null,
		activeBranch: null,
		status: {kind: 'idle', message: 'deleted feat/a'},
	});
	const deleteWorktree = vi.fn(async () => deleted);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), deleteWorktree}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('d');
	await waitForInput();
	stdin.write('y');
	await waitForInput();
	await waitForInput();
	expect(deleteWorktree).toHaveBeenCalledWith('/repo/.worktree/feat-a');
	await vi.waitFor(() => expect(lastFrame()).toContain('deleted feat/a'));
});

it('ignores setup key when setupCommand is not configured', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
		setupAvailable: false,
	});
	const setup = vi.fn();
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), setup}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('i');
	await waitForInput();
	expect(setup).not.toHaveBeenCalled();
	expect(lastFrame()).toContain('Ready to launch with the configured command in this worktree.');
	expect(lastFrame()).not.toContain('i setup');
	expect(lastFrame()).not.toContain('↵ i');
});

it('starts without running setup when enter is pressed and setup is available', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
		setupAvailable: true,
	});
	const started = {...model, activePath: '/repo/.worktree/feat-a', activeBranch: 'feat/a', status: {kind: 'running' as const, message: 'started feat/a'}};
	const setup = vi.fn(async () => model);
	const start = vi.fn(async () => started);
	const {lastFrame, stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), setup, start}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('\r');
	await waitForInput();
	await waitForInput();
	await waitForInput();
	expect(start).toHaveBeenCalledWith('/repo/.worktree/feat-a');
	expect(setup).not.toHaveBeenCalled();
	await vi.waitFor(() => expect(lastFrame()).toContain('Running: feat/a'));
});


it('ignores repeated enter presses while start is already in flight', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const deferred = Promise.withResolvers<AppModel>();
	const start = vi.fn(async () => deferred.promise);
	const {stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);
	stdin.write('\r');
	stdin.write('\r');
	await waitForInput();
	expect(start).toHaveBeenCalledTimes(1);
	deferred.resolve({...model, status: {kind: 'running', message: 'started feat/a'}});
	await waitForInput();
});

it('debounces repeated enter presses after a fast start finishes', async () => {
	const model = createModel({
		rows: [{path: '/repo/.worktree/feat-a', shortPath: '.worktree/feat-a', branch: 'feat/a', tags: []}],
		activePath: null,
		activeBranch: null,
	});
	const start = vi.fn(async () => ({...model, activePath: '/repo/.worktree/feat-a', activeBranch: 'feat/a', status: {kind: 'running' as const, message: 'started feat/a'}}));
	const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
	try {
		const {stdin} = render(<App initialModel={model} actions={{...makeFakeActions(model), start}} windowSizeOverride={{columns: 120, rows: 30}} />);
		stdin.write('\r');
		await waitForInput();
		await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
		now.mockReturnValue(1200);
		stdin.write('\r');
		await waitForInput();
		expect(start).toHaveBeenCalledTimes(1);
	} finally {
		now.mockRestore();
	}
});

