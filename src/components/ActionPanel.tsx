import {Box, Text} from 'ink';
import type {AppRow} from '../core/runtime.js';
import {
	getOrderedNonActiveTags,
	projectAction,
	projectHeadCommit,
	projectNote,
	projectPullRequest,
	projectUpstream,
	projectWorkingTree,
	sanitizeInlineText,
	type ProjectionSeverity,
	type PullRequestProjection,
	type TagProjection,
	type WorkingTreePartKind,
} from '../core/worktree-projection.js';
import {getScrollbarThumbRows, sliceListViewport} from '../terminal/viewport.js';

export function getActionVariant(selectedRow: AppRow, activePath: string | null): ProjectionSeverity {
	return projectAction(selectedRow, activePath).severity;
}

function formatUpstream(selectedRow: AppRow): string {
	const upstream = projectUpstream(selectedRow);
	if (upstream.kind === 'unavailable') {
		return 'unavailable';
	}
	if (upstream.kind === 'none') {
		return '-';
	}
	return `${upstream.branch} (↑${upstream.ahead} ↓${upstream.behind})`;
}

function getTagColor(tag: TagProjection['tag']): 'green' | 'yellow' | 'blue' | 'red' | 'magenta' {
	if (tag === 'active') {
		return 'green';
	}
	if (tag === 'external') {
		return 'yellow';
	}
	if (tag === 'main') {
		return 'blue';
	}
	if (tag === 'invalid') {
		return 'red';
	}
	return 'magenta';
}

function getTagLabel(tag: TagProjection['tag']): string {
	return tag === 'main' ? 'root' : tag;
}

function getWorkingTreePartLabel(kind: WorkingTreePartKind): string {
	if (kind === 'staged') {
		return 'index';
	}
	if (kind === 'unstaged') {
		return 'worktree';
	}
	return kind;
}

function formatWorkingTree(selectedRow: AppRow): string {
	const workingTree = projectWorkingTree(selectedRow);
	if (workingTree.kind === 'unavailable') {
		return 'unavailable';
	}
	if (workingTree.kind === 'clean') {
		return 'clean';
	}
	const parts = workingTree.parts.map(part => `${getWorkingTreePartLabel(part.kind)} ${part.count}`);
	return `dirty (${parts.join(' · ')})`;
}

function formatUtcDateTime(timestampMs: number | undefined): string {
	if (timestampMs === undefined || !Number.isFinite(timestampMs)) {
		return '-';
	}
	const iso = new Date(timestampMs).toISOString();
	return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

function formatPullRequest(selectedRow: AppRow): string {
	const pullRequest = projectPullRequest(selectedRow);
	if (pullRequest.kind === 'none') {
		return 'none';
	}
	if (pullRequest.kind === 'unavailable') {
		return 'unavailable';
	}
	const draft = pullRequest.isDraft ? 'draft/' : '';
	const stateText = pullRequest.state.toLowerCase();
	return `#${pullRequest.number} ${draft}${stateText} → ${pullRequest.baseBranch}`;
}

function formatHeadCommit(selectedRow: AppRow): string {
	const headCommit = projectHeadCommit(selectedRow);
	if (headCommit.kind === 'unavailable') {
		return '-';
	}
	return headCommit.label;
}

function getPullRequestColorFromProjection(pullRequest: PullRequestProjection): 'green' | 'yellow' | 'red' | undefined {
	if (pullRequest.kind === 'unavailable') {
		return 'red';
	}
	if (pullRequest.kind !== 'found' || pullRequest.isHistorical) {
		return undefined;
	}
	return pullRequest.isDraft ? 'yellow' : 'green';
}

export function getPullRequestColor(selectedRow: AppRow): 'green' | 'yellow' | 'red' | undefined {
	return getPullRequestColorFromProjection(projectPullRequest(selectedRow));
}

function getPullRequestLabel(pullRequest: PullRequestProjection): 'PR' | 'Last PR' {
	return pullRequest.kind === 'found' && pullRequest.isHistorical ? 'Last PR' : 'PR';
}

function getPullRequestTitleLabel(pullRequest: PullRequestProjection): 'PR Title' | 'Last PR Title' {
	return pullRequest.kind === 'found' && pullRequest.isHistorical ? 'Last PR Title' : 'PR Title';
}

function getPullRequestDimColor(pullRequest: PullRequestProjection): boolean {
	return pullRequest.kind === 'found' && pullRequest.isHistorical;
}

function getActionMessage(selectedRow: AppRow, activePath: string | null): string {
	const action = projectAction(selectedRow, activePath);
	if (action.kind === 'blocked') {
		return 'Cannot start this worktree.';
	}
	if (action.kind === 'active') {
		return 'Already active. Press Enter to restart, or s to stop.';
	}
	return 'Press Enter to start here and switch the active session.';
}

function getNotes(selectedRow: AppRow): string {
	const note = projectNote(selectedRow);
	if (note.kind === 'invalid') {
		return note.invalidReason;
	}
	if (note.kind === 'external') {
		return 'External worktree managed outside the main checkout path.';
	}
	return 'Ready to launch with the configured command in this worktree.';
}

type LineSpec = {
	text: string;
	color?: 'cyan' | 'green' | 'yellow' | 'blue' | 'red' | 'magenta';
	dimColor?: boolean;
	bold?: boolean;
};

function getVariantColor(variant: 'success' | 'error' | 'info'): 'green' | 'red' | 'blue' {
	if (variant === 'success') {
		return 'green';
	}
	if (variant === 'error') {
		return 'red';
	}
	return 'blue';
}

function getVariantIcon(variant: 'success' | 'error' | 'info'): '✓' | '✘' | 'ℹ' {
	if (variant === 'success') {
		return '✓';
	}
	if (variant === 'error') {
		return '✘';
	}
	return 'ℹ';
}

function section(label: string): LineSpec {
	return {text: `[${label}]`, color: 'cyan', bold: true};
}

function divider(): LineSpec {
	return {text: ' ', dimColor: true};
}

function getPanelLines(selectedRow: AppRow | undefined, activePath: string | null, setupAvailable: boolean, compactDetails: boolean): LineSpec[] {
	if (!selectedRow) {
		return [{text: 'No worktrees found.', dimColor: true}];
	}

	const lines: LineSpec[] = [section('Identity')];
	const showFullPath = !compactDetails && selectedRow.shortPath !== selectedRow.path;
	const showTags = !compactDetails;
	const pullRequest = projectPullRequest(selectedRow);
	const pullRequestTitle = pullRequest.kind === 'found' && !compactDetails ? pullRequest.title : null;

	lines.push(
		{text: `Branch: ${sanitizeInlineText(selectedRow.branch)}`, bold: true},
		{text: `Path: ${sanitizeInlineText(selectedRow.shortPath)}`},
	);
	if (showFullPath) {
		lines.push({text: `Full Path: ${sanitizeInlineText(selectedRow.path)}`});
	}
	lines.push({text: `HEAD: ${formatHeadCommit(selectedRow)}`});
	lines.push({text: `Branch Created: ${formatUtcDateTime(selectedRow.branchCreatedAtMs)}`});

	if (showTags) {
		for (const {tag} of getOrderedNonActiveTags(selectedRow.tags)) {
			lines.push({text: getTagLabel(tag).toUpperCase(), color: getTagColor(tag)});
		}
	}

	lines.push(
		divider(),
		section('Git / PR'),
		{text: `Upstream: ${formatUpstream(selectedRow)}`},
		{text: `Status: ${formatWorkingTree(selectedRow)}`},
		{
			text: `${getPullRequestLabel(pullRequest)}: ${formatPullRequest(selectedRow)}`,
			color: getPullRequestColorFromProjection(pullRequest),
			dimColor: getPullRequestDimColor(pullRequest),
		},
	);
	if (pullRequestTitle) {
		lines.push({text: `${getPullRequestTitleLabel(pullRequest)}: ${pullRequestTitle}`, dimColor: getPullRequestDimColor(pullRequest)});
	}

	const actionVariant = getActionVariant(selectedRow, activePath);
	const noteVariant = projectNote(selectedRow).severity;
	lines.push(
		divider(),
		section('Action'),
		{text: `${getVariantIcon(actionVariant)} ${getActionMessage(selectedRow, activePath)}`, color: getVariantColor(actionVariant)},
	);
	if (setupAvailable) {
		lines.push({text: 'ℹ Press i to run setup in this worktree.', color: 'blue'});
	}
	lines.push(
		section('Notes'),
		{text: `${getVariantIcon(noteVariant)} ${getNotes(selectedRow)}`, color: getVariantColor(noteVariant)},
	);

	return lines;
}


export function ActionPanel({
	selectedRow,
	activePath,
	setupAvailable,
	stacked,
	width,
	height,
	compactDetails,
	scrollOffset = 0,
}: {
	selectedRow: AppRow | undefined;
	activePath: string | null;
	setupAvailable: boolean;
	stacked: boolean;
	width?: number;
	height?: number;
	compactDetails?: boolean;
	scrollOffset?: number;
}) {
	const lines = getPanelLines(selectedRow, activePath, setupAvailable, compactDetails ?? false);
	const viewport = height === undefined ? undefined : sliceListViewport(lines, height - 3, scrollOffset);
	const contentViewportHeight = viewport?.viewportHeight;
	const effectiveScrollOffset = viewport?.scrollOffset ?? 0;
	const visibleLines = viewport?.visibleItems ?? lines;

	const showScrollbar = viewport !== undefined && lines.length > viewport.viewportHeight;
	const scrollbarThumbRows = showScrollbar
		? getScrollbarThumbRows(lines.length, viewport.viewportHeight, viewport.scrollOffset)
		: new Set<number>();

	return (
		<Box width={width} height={height} flexGrow={stacked ? 0 : 1} flexShrink={1} borderStyle="round" borderColor="magenta" flexDirection="column" paddingX={1} overflow="hidden">
			<Text bold color="magenta" wrap="truncate-end">
				Selection / Action
			</Text>
			<Box height={contentViewportHeight} flexDirection="column" overflow="hidden">
				{visibleLines.map((line, index) => (
					<Box key={`${effectiveScrollOffset + index}-${line.text}`} flexDirection="row">
						<Box flexGrow={1} flexShrink={1}>
							<Text color={line.color} dimColor={line.dimColor} bold={line.bold} wrap="wrap">
								{line.text}
							</Text>
						</Box>
						{showScrollbar ? (
							<Text color={scrollbarThumbRows.has(index) ? 'magenta' : 'gray'} dimColor={!scrollbarThumbRows.has(index)}>
								{scrollbarThumbRows.has(index) ? '█' : '│'}
							</Text>
						) : null}
					</Box>
				))}
			</Box>
		</Box>
	);
}
