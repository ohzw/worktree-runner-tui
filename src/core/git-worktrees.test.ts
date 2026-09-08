import {execFileSync} from 'node:child_process';
import {mkdtempSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {parseWorktreeListPorcelain, readWorktrees, sortWorktrees, toShortPath} from './git-worktrees.js';

const porcelain = `worktree /repo
HEAD aaa
branch refs/heads/develop

worktree /repo/.worktree/feat-a
HEAD bbb
branch refs/heads/feat/a

worktree /repo-other
HEAD ccc
branch refs/heads/fix/x
`;

function initGitRepo(root: string): void {
	execFileSync('git', ['init'], {cwd: root});
	execFileSync('git', ['config', 'user.email', 'wctui@example.invalid'], {cwd: root});
	execFileSync('git', ['config', 'user.name', 'wctui test'], {cwd: root});
	writeFileSync(path.join(root, 'README.md'), 'ready\n');
	execFileSync('git', ['add', 'README.md'], {cwd: root});
	execFileSync('git', ['commit', '-m', 'initial'], {cwd: root});
}

describe('parseWorktreeListPorcelain', () => {
	it('parses branch name, absolute path, and external flag with path boundaries', () => {
		const rows = parseWorktreeListPorcelain(porcelain, '/repo');
		expect(rows.map(row => row.branch)).toEqual(['develop', 'feat/a', 'fix/x']);
		expect(rows[0]?.isMain).toBe(true);
		expect(rows[2]?.isExternal).toBe(true);
	});
});

describe('sortWorktrees', () => {
	it('keeps the main worktree first and orders dated worktrees by creation date', () => {
		const rows = parseWorktreeListPorcelain(porcelain, '/repo').map(row => ({
			...row,
			createdAtMs: row.path === '/repo' ? 3 : row.path === '/repo-other' ? 2 : 1,
		}));
		const sorted = sortWorktrees(rows, '/repo/.worktree/feat-a');
		expect(sorted.map(row => row.path)).toEqual(['/repo', '/repo/.worktree/feat-a', '/repo-other']);
	});

	it('places undated non-main worktrees after dated worktrees', () => {
		const rows = parseWorktreeListPorcelain(porcelain, '/repo').map(row => ({
			...row,
			createdAtMs: row.path === '/repo/.worktree/feat-a' ? null : row.path === '/repo' ? 3 : 1,
		}));
		const sorted = sortWorktrees(rows, '/repo-other');
		expect(sorted.map(row => row.path)).toEqual(['/repo', '/repo-other', '/repo/.worktree/feat-a']);
	});

	it('orders undated worktrees by branch and path without using active status', () => {
		const rows = parseWorktreeListPorcelain(porcelain, '/repo').map(row => ({
			...row,
			createdAtMs: row.path === '/repo' ? 1 : null,
		}));
		const sorted = sortWorktrees(rows, '/repo-other');
		expect(sorted.map(row => row.path)).toEqual(['/repo', '/repo/.worktree/feat-a', '/repo-other']);
	});

	it('does not use active status as a tie-breaker for equal creation dates', () => {
		const rows = parseWorktreeListPorcelain(porcelain, '/repo').map(row => ({
			...row,
			createdAtMs: 1,
		}));
		const sorted = sortWorktrees(rows, '/repo-other');
		expect(sorted.map(row => row.path)).toEqual(['/repo', '/repo/.worktree/feat-a', '/repo-other']);
	});
});

describe('readWorktrees', () => {
	it('adds filesystem creation timestamps to parsed git worktrees', async () => {
		const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'wctui-worktrees-')));
		initGitRepo(root);
		const worktreePath = path.join(root, '..', `${path.basename(root)}-feat-a`);
		execFileSync('git', ['worktree', 'add', worktreePath, '-b', 'feat/a'], {cwd: root});

		const rows = await readWorktrees(root, root);
		const createdAtValues = rows.map(row => row.createdAtMs);
		expect(createdAtValues).toHaveLength(2);
		expect(createdAtValues.every(value => typeof value === 'number' && Number.isFinite(value))).toBe(true);
	});
});

describe('toShortPath', () => {
	it('shortens repo-local paths and keeps external paths absolute', () => {
		expect(toShortPath('/repo', '/repo')).toBe('.');
		expect(toShortPath('/repo', '/repo/.worktree/feat-a')).toBe('.worktree/feat-a');
		expect(toShortPath('/repo', '/repo-other')).toBe('/repo-other');
	});
});
