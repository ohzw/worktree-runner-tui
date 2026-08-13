import React from 'react';
import {render} from 'ink-testing-library';
import {describe, expect, it} from 'vitest';
import {ActionPanel, getActionVariant, getPullRequestColor} from './ActionPanel.js';
import type {AppRow} from '../core/runtime.js';

function makeRow(overrides: Partial<AppRow> = {}): AppRow {
	return {
		path: '/repo/.worktree/feat-a',
		shortPath: '.worktree/feat-a',
		branch: 'feat/a',
		tags: [],
		...overrides,
	};
}

function stripAnsi(value: string | null | undefined): string {
	return (value ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

describe('getPullRequestColor', () => {
	it('uses green for open PRs, yellow for drafts, red for unavailable, and neutral otherwise', () => {
		expect(getPullRequestColor(makeRow({pullRequest: {kind: 'found', number: 1, title: 'Ready', url: 'https://example.com/1', state: 'OPEN', isDraft: false, baseBranch: 'develop'}}))).toBe('green');
		expect(getPullRequestColor(makeRow({pullRequest: {kind: 'found', number: 2, title: 'Draft', url: 'https://example.com/2', state: 'OPEN', isDraft: true, baseBranch: 'develop'}}))).toBe('yellow');
		expect(getPullRequestColor(makeRow({pullRequest: {kind: 'unavailable'}}))).toBe('red');
		expect(getPullRequestColor(makeRow({pullRequest: {kind: 'found', number: 3, title: 'Merged', url: 'https://example.com/3', state: 'MERGED', isDraft: false, baseBranch: 'develop'}}))).toBeUndefined();
		expect(getPullRequestColor(makeRow({pullRequest: {kind: 'none'}}))).toBeUndefined();
	});
});

describe('getActionVariant', () => {
	it('uses success, info, and error variants for different action states', () => {
		expect(getActionVariant(makeRow({invalidReason: 'Missing required files'}), null)).toBe('error');
		expect(getActionVariant(makeRow({workingTree: {staged: 0, unstaged: 0, untracked: 0, conflicts: 1}}), null)).toBe('error');
		expect(getActionVariant(makeRow({workingTree: {staged: 1, unstaged: 0, untracked: 0, conflicts: 0}}), null)).toBe('info');
		expect(getActionVariant(makeRow({workingTree: {staged: 0, unstaged: 1, untracked: 0, conflicts: 0}}), null)).toBe('info');
		expect(getActionVariant(makeRow({workingTree: {staged: 0, unstaged: 0, untracked: 1, conflicts: 0}}), null)).toBe('info');
		expect(getActionVariant(makeRow({tags: ['active']}), '/repo/.worktree/feat-a')).toBe('success');
		expect(getActionVariant(makeRow(), null)).toBe('info');
	});
});

describe('ActionPanel', () => {
	it('renders the selected row head summary in the detail pane', () => {
		const {lastFrame} = render(
			<ActionPanel
				selectedRow={makeRow({
					headSha: '46af3f1c',
					headCommit: {message: 'Selection\npane\u001b[2J metadata'},
				})}
				activePath={null}
				setupAvailable={false}
				stacked={false}
				width={100}
				height={20}
			/>,
		);

		const frame = stripAnsi(lastFrame());
		expect(frame).toContain('Selection / Action');
		expect(frame).toContain('HEAD: 46af3f1c Selection pane metadata');
		expect(frame).not.toContain('undefined');
		expect(frame).not.toContain('null');
	});

	it('wraps detail rows instead of truncating them', () => {
		const {lastFrame} = render(
			<ActionPanel
				selectedRow={makeRow({
					branch: 'feature/this-is-a-long-branch-name-for-a-narrow-pane',
					path: '/repo/.worktree/feature/deeply-nested-worktree',
					headSha: '46af3f1c',
					headCommit: {message: 'Render the complete commit summary in narrow panes'},
				})}
				activePath={null}
				setupAvailable={false}
				stacked={false}
				width={30}
				height={30}
			/>,
		);
		const frame = stripAnsi(lastFrame());

		const compactFrame = frame.replace(/[\s│╭╮╰╯─]/gu, '');
		expect(compactFrame).toContain('Branch:feature/this-is-a-long-branch-name-for-a-narrow-pane');
		expect(compactFrame).toContain('FullPath:/repo/.worktree/feature/deeply-nested-worktree');
		expect(compactFrame).toContain('HEAD:46af3f1cRenderthecompletecommitsummaryinnarrowpanes');
	});

	it('falls back safely when head metadata is missing', () => {
		const {lastFrame} = render(
			<ActionPanel
				selectedRow={makeRow()}
				activePath={null}
				setupAvailable={false}
				stacked={false}
				width={100}
				height={20}
			/>,
		);

		const frame = stripAnsi(lastFrame());
		expect(frame).toContain('HEAD: -');
		expect(frame).not.toContain('undefined');
		expect(frame).not.toContain('null');
	});
});
