import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

export interface SessionRecord {
	namespace: string;
	worktreePath: string;
	branch: string;
	pid: number;
	pgid: number;
	port: number;
	ports?: number[];
	logPath: string;
	startedAt: string;
}

function isSafeProcessId(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 1;
}

function isSafePort(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

interface ReadSessionRecord {
	namespace: string;
	worktreePath: string;
	branch: string;
	pid: number;
	pgid: number;
	port: number;
	ports: number[];
	logPath: string;
	startedAt: string;
}

function normalizeSessionRecordPorts(port: number | undefined, ports: number[] | undefined): number[] {
	if (ports !== undefined && ports.length > 0) {
		return ports;
	}
	if (port !== undefined) {
		return [port];
	}
	return [];
}

function parseSessionRecord(value: unknown): ReadSessionRecord | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}

	const record = value as Partial<ReadSessionRecord>;
	const parsedPorts = normalizeSessionRecordPorts(record.port, Array.isArray(record.ports) ? (record.ports as number[]) : undefined);
	if (
		typeof record.namespace !== 'string' ||
		typeof record.worktreePath !== 'string' ||
		typeof record.branch !== 'string' ||
		!isSafeProcessId(record.pgid) ||
		!isSafeProcessId(record.pid) ||
		!isSafePort(record.port) ||
		!parsedPorts.every(isSafePort) ||
		parsedPorts.length === 0 ||
		typeof record.logPath !== 'string' ||
		typeof record.startedAt !== 'string'
	) {
		return null;
	}
	return {...record, ports: parsedPorts} as ReadSessionRecord;
}

export interface SessionPaths {
	baseDir: string;
	logsDir: string;
	sessionFile: string;
}
const MAX_SESSION_BYTES = 16 * 1024;
// Keep the original directory stable so upgrades can still inspect and stop active sessions.
const SESSION_STORAGE_DIRECTORY = 'worktree-command-tui';



export function getSessionPaths(gitCommonDir: string, namespace: string): SessionPaths {
	const baseDir = path.join(gitCommonDir, SESSION_STORAGE_DIRECTORY);
	return {
		baseDir,
		logsDir: path.join(baseDir, 'logs'),
		sessionFile: path.join(baseDir, `${namespace}.json`),
	};
}

async function readSessionFile(sessionFile: string): Promise<string | null> {
	if ((await stat(sessionFile)).size > MAX_SESSION_BYTES) {
		await rm(sessionFile, {force: true});
		return null;
	}
	return readFile(sessionFile, 'utf8');
}

export async function readSessionRecord(
	paths: Pick<SessionPaths, 'sessionFile'>,
	{isSessionAlive}: {isSessionAlive: (pgid: number) => Promise<boolean>},
): Promise<SessionRecord | null> {
	try {
		const source = await readSessionFile(paths.sessionFile);
		if (source === null) {
			return null;
		}
		const parsed = parseSessionRecord(JSON.parse(source) as unknown);
		if (parsed === null) {
			await rm(paths.sessionFile, {force: true});
			return null;
		}
		if (!(await isSessionAlive(parsed.pgid))) {
			await rm(paths.sessionFile, {force: true});
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export async function writeSessionRecord(
	paths: Pick<SessionPaths, 'baseDir' | 'sessionFile'>,
	record: SessionRecord,
): Promise<void> {
	await mkdir(paths.baseDir, {recursive: true});
	await writeFile(
		paths.sessionFile,
		JSON.stringify(
			{
				...record,
				ports: record.ports ?? [record.port],
			},
			null,
			2,
		),
	);
}


export async function clearSessionRecord(paths: Pick<SessionPaths, 'sessionFile'>): Promise<void> {
	await rm(paths.sessionFile, {force: true});
}
