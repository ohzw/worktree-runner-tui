import {describe, expect, it} from 'vitest';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {getSessionPaths, readSessionRecord, writeSessionRecord} from './session-store.js';

describe('session-store', () => {
	it('keeps state in the pre-rename directory so active sessions survive upgrades', async () => {
		const commonDir = mkdtempSync(path.join(tmpdir(), 'wtr-session-'));
		const paths = getSessionPaths(commonDir, 'rojo-serve');
		expect(paths.baseDir).toBe(path.join(commonDir, 'worktree-command-tui'));
		await writeSessionRecord(paths, {
			namespace: 'rojo-serve',
			worktreePath: '/repo/.worktree/feat-a',
			branch: 'feat/a',
			pid: 123,
			pgid: 123,
			port: 34872,
			ports: [34872, 5173],
			logPath: '/tmp/rojo.log',
			startedAt: '2026-06-03T00:00:00.000Z',
		});
		expect(readFileSync(paths.sessionFile, 'utf8')).toContain('feat/a');
		const stored = JSON.parse(readFileSync(paths.sessionFile, 'utf8')) as {ports?: number[]};
		expect(stored.ports).toEqual([34872, 5173]);
	});

	it('returns null when the file is missing', async () => {
		const commonDir = mkdtempSync(path.join(tmpdir(), 'wctui-session-empty-'));
		const paths = getSessionPaths(commonDir, 'rojo-serve');
		await expect(readSessionRecord(paths, {isSessionAlive: async () => true})).resolves.toBeNull();
	});

	it('prunes stale session files when pid/pgid is no longer alive', async () => {
		const commonDir = mkdtempSync(path.join(tmpdir(), 'wctui-session-stale-'));
		const paths = getSessionPaths(commonDir, 'rojo-serve');
		await writeSessionRecord(paths, {
			namespace: 'rojo-serve',
			worktreePath: '/repo/.worktree/stale',
			branch: 'stale',
			pid: 999,
			pgid: 999,
			port: 34872,
			logPath: '/tmp/stale.log',
			startedAt: '2026-06-03T00:00:00.000Z',
		});
		await expect(readSessionRecord(paths, {isSessionAlive: async () => false})).resolves.toBeNull();
	});

	it('normalizes legacy session files without ports arrays', async () => {
		const commonDir = mkdtempSync(path.join(tmpdir(), 'wctui-session-legacy-port-'));
		const paths = getSessionPaths(commonDir, 'rojo-serve');
		await writeSessionRecord(paths, {
			namespace: 'rojo-serve',
			worktreePath: '/repo/.worktree/legacy',
			branch: 'legacy',
			pid: 999,
			pgid: 999,
			port: 34872,
			ports: undefined,
			logPath: '/tmp/legacy.log',
			startedAt: '2026-06-03T00:00:00.000Z',
		});

		const stored = JSON.parse(readFileSync(paths.sessionFile, 'utf8')) as {ports?: number[]};
		delete stored.ports;
		writeFileSync(paths.sessionFile, JSON.stringify(stored));

		await expect(readSessionRecord(paths, {isSessionAlive: async () => true})).resolves.toMatchObject({
			port: 34872,
			ports: [34872],
		});
	});

	it('rejects unsafe session process groups before checking liveness', async () => {
		const commonDir = mkdtempSync(path.join(tmpdir(), 'wctui-session-unsafe-'));
		const paths = getSessionPaths(commonDir, 'rojo-serve');
		await writeSessionRecord(paths, {
			namespace: 'rojo-serve',
			worktreePath: '/repo/.worktree/unsafe',
			branch: 'unsafe',
			pid: 1,
			pgid: 1,
			port: 34872,
			logPath: '/tmp/unsafe.log',
			startedAt: '2026-06-03T00:00:00.000Z',
		});

		await expect(readSessionRecord(paths, {isSessionAlive: async () => {
			throw new Error('liveness should not be checked for unsafe pgid');
		}})).resolves.toBeNull();
		expect(existsSync(paths.sessionFile)).toBe(false);
	});

	it('rejects oversized session files before parsing them', async () => {
		const commonDir = mkdtempSync(path.join(tmpdir(), 'wctui-session-large-'));
		const paths = getSessionPaths(commonDir, 'rojo-serve');
		await writeSessionRecord(paths, {
			namespace: 'rojo-serve',
			worktreePath: '/repo/.worktree/large',
			branch: 'x'.repeat(100000),
			pid: 999,
			pgid: 999,
			port: 34872,
			logPath: '/tmp/large.log',
			startedAt: '2026-06-03T00:00:00.000Z',
		});

		await expect(readSessionRecord(paths, {isSessionAlive: async () => true})).resolves.toBeNull();
		expect(existsSync(paths.sessionFile)).toBe(false);
	});
});
