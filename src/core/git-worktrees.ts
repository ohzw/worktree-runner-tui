import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeRow {
	path: string;
	branch: string;
	headSha: string;
	isMain: boolean;
	isExternal: boolean;
	createdAtMs: number | null;
}

function isExternalWorktree(mainWorktreePath: string, worktreePath: string): boolean {
	const relativePath = path.relative(mainWorktreePath, worktreePath);
	return relativePath !== '' && (relativePath === '..' || relativePath.startsWith(`..${path.sep}`));
}

export function parseWorktreeListPorcelain(input: string, mainWorktreePath: string): WorktreeRow[] {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return [];
	}

	return trimmed
		.split(/\n\s*\n/)
		.filter(Boolean)
		.map(block => {
			const lines = block.split('\n');
			const pathLine = lines.find(line => line.startsWith('worktree '));
			const headLine = lines.find(line => line.startsWith('HEAD '));
			const branchLine = lines.find(line => line.startsWith('branch '));
			const detached = lines.includes('detached');
			const worktreePath = pathLine?.slice('worktree '.length) ?? '';
			const fullRef = branchLine?.slice('branch '.length) ?? '';

			return {
				path: worktreePath,
				branch: branchLine ? fullRef.replace('refs/heads/', '') : detached ? '(detached)' : '(unknown)',
				headSha: headLine?.slice('HEAD '.length) ?? '',
				isMain: worktreePath === mainWorktreePath,
				isExternal: isExternalWorktree(mainWorktreePath, worktreePath),
				createdAtMs: null,
			};
		});
}


export function sortWorktrees(rows: WorktreeRow[], _activePath: string | null): WorktreeRow[] {
	return [...rows].sort((left, right) => {
		if (left.isMain !== right.isMain) {
			return left.isMain ? -1 : 1;
		}

		const leftCreated = left.createdAtMs;
		const rightCreated = right.createdAtMs;
		if (leftCreated === null || rightCreated === null) {
			if (leftCreated !== rightCreated) {
				return leftCreated === null ? 1 : -1;
			}
		} else if (leftCreated !== rightCreated) {
			return leftCreated - rightCreated;
		}

		const branchCompare = left.branch.localeCompare(right.branch);
		return branchCompare !== 0 ? branchCompare : left.path.localeCompare(right.path);
	});
}

async function readWorktreeCreatedAtMs(worktreePath: string): Promise<number | null> {
	try {
		const stats = await stat(worktreePath);
		return stats.birthtimeMs;
	} catch {
		return null;
	}
}

export async function readWorktrees(cwd: string, mainWorktreePath: string): Promise<WorktreeRow[]> {
	const {stdout} = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {cwd});
	const rows = parseWorktreeListPorcelain(stdout, mainWorktreePath);
	return Promise.all(rows.map(async row => ({
		...row,
		createdAtMs: await readWorktreeCreatedAtMs(row.path),
	})));
}

export function toShortPath(mainWorktreePath: string, worktreePath: string): string {
	if (worktreePath === mainWorktreePath) {
		return '.';
	}
	if (worktreePath.startsWith(`${mainWorktreePath}${path.sep}`)) {
		return path.relative(mainWorktreePath, worktreePath);
	}
	return worktreePath;
}
