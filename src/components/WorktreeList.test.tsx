import React, {type ReactElement, type ReactNode} from 'react';
import {describe, expect, it} from 'vitest';
import {WorktreeList} from './WorktreeList.js';
import type {AppRow} from '../core/runtime.js';

type InspectableElement = ReactElement<{children?: ReactNode; color?: string; dimColor?: boolean}>;

function textContent(node: ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(textContent).join('');
	}

	if (React.isValidElement<{children?: ReactNode}>(node)) {
		return textContent(node.props.children);
	}

	return '';
}

function collectElements(node: ReactNode): InspectableElement[] {
	if (Array.isArray(node)) {
		return node.flatMap(child => collectElements(child));
	}

	if (!React.isValidElement<{children?: ReactNode}>(node)) {
		return [];
	}

	return [node, ...collectElements(node.props.children)];
}

function getRowText(tree: ReactNode, needle: string): string {
	const row = collectElements(tree).find(element => textContent(element.props.children).includes(needle));
	if (row === undefined) {
		throw new Error(`Could not find row containing ${JSON.stringify(needle)}`);
	}

	return textContent(row.props.children);
}

describe('WorktreeList', () => {
	it('renders the branch label without head commit metadata in list rows', () => {
		const rows: AppRow[] = [
			{
				path: '/repo/.worktree/feat-a',
				shortPath: '.worktree/feat-a',
				branch: 'feat/a',
				tags: ['active'],
				headSha: '46af3f1c',
				headCommit: {message: 'Selection\npane\u001b[2J metadata'},
			},
		];

		const tree = WorktreeList({rows, selectedIndex: 0, width: 80, height: 10, stacked: false});
		const rowText = getRowText(tree, 'feat/a');

		expect(rowText).toContain('feat/a');
		expect(rowText).not.toContain('46af3f1c');
		expect(rowText).not.toContain('Selection pane metadata');
		expect(rowText).not.toContain('\u001b');
	});

	it('renders the Nerd Font pull request icon only for found PR metadata', () => {
		const rows: AppRow[] = [
			{
				path: '/repo/.worktree/feat-with-pr',
				shortPath: '.worktree/feat-with-pr',
				branch: 'feat/with-pr',
				tags: [],
				pullRequest: {
					kind: 'found',
					number: 42,
					title: 'Add auth',
					url: 'https://github.com/example/repo/pull/42',
					state: 'OPEN',
					isDraft: false,
					baseBranch: 'main',
				},
			},
			{
				path: '/repo/.worktree/feat-draft',
				shortPath: '.worktree/feat-draft',
				branch: 'feat/draft',
				tags: [],
				pullRequest: {
					kind: 'found',
					number: 43,
					title: 'Draft auth',
					url: 'https://github.com/example/repo/pull/43',
					state: 'OPEN',
					isDraft: true,
					baseBranch: 'main',
				},
			},
			{
				path: '/repo/.worktree/feat-merged',
				shortPath: '.worktree/feat-merged',
				branch: 'feat/merged',
				tags: [],
				pullRequest: {
					kind: 'found',
					number: 44,
					title: 'Merged auth',
					url: 'https://github.com/example/repo/pull/44',
					state: 'MERGED',
					isDraft: false,
					baseBranch: 'main',
				},
			},
			{
				path: '/repo/.worktree/feat-closed',
				shortPath: '.worktree/feat-closed',
				branch: 'feat/closed',
				tags: [],
				pullRequest: {
					kind: 'found',
					number: 45,
					title: 'Closed auth',
					url: 'https://github.com/example/repo/pull/45',
					state: 'CLOSED',
					isDraft: false,
					baseBranch: 'main',
				},
			},
			{
				path: '/repo/.worktree/feat-without-pr',
				shortPath: '.worktree/feat-without-pr',
				branch: 'feat/without-pr',
				tags: [],
				pullRequest: {kind: 'none'},
			},
			{
				path: '/repo/.worktree/feat-unavailable',
				shortPath: '.worktree/feat-unavailable',
				branch: 'feat/unavailable',
				tags: [],
				pullRequest: {kind: 'unavailable'},
			},
		];
		const tree = WorktreeList({rows, selectedIndex: 0, width: 80, height: 10, stacked: false});
		const rendered = textContent(tree);

		expect(rendered).toContain('\u{f407} feat/with-pr');
		expect(rendered).toContain('\u{f4dd} feat/draft');
		expect(rendered).toContain('\u{f4dc} feat/closed');
		expect(rendered).toContain('\u{f419} feat/merged');
		for (const icon of ['\u{f407}', '\u{f4dd}', '\u{f4dc}', '\u{f419}']) {
			expect(rendered).not.toContain(`${icon} feat/without-pr`);
			expect(rendered).not.toContain(`${icon} feat/unavailable`);
		}
		const iconElements = collectElements(tree).filter(element => ['\u{f407}', '\u{f4dd}', '\u{f4dc}', '\u{f419}'].some(icon => icon === textContent(element.props.children)));
		expect(iconElements).toHaveLength(4);
		expect(iconElements.map(element => [textContent(element.props.children), element.props.color, element.props.dimColor])).toEqual([
			['\u{f407}', 'green', false],
			['\u{f4dd}', 'yellow', false],
			['\u{f419}', undefined, true],
			['\u{f4dc}', undefined, true],
		]);
	});


	it('truncates narrow rows without dropping branch, PR, or root indicators', () => {
		const rows: AppRow[] = [
			{
				path: '/repo',
				shortPath: '.',
				branch: 'feature/with-a-really-long-branch-name',
				tags: ['main'],
				pullRequest: {
					kind: 'found',
					number: 42,
					title: 'Long branch',
					url: 'https://github.com/example/repo/pull/42',
					state: 'OPEN',
					isDraft: false,
					baseBranch: 'main',
				},
				headSha: '46af3f1c',
				headCommit: {message: 'Selection pane metadata'},
			},
		];

		const tree = WorktreeList({rows, selectedIndex: 0, width: 34, stacked: false});
		const rowText = getRowText(tree, '[root]');

		expect(rowText).toContain(`> - \u{f407} `);
		expect(rowText).toContain('[root]');
		expect(rowText).toContain('…');
		expect(rowText).not.toContain('46af3f1c');
		expect(rowText).not.toContain('Selection pane metadata');
	});

});
