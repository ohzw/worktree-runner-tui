import {Box, Text} from 'ink';
import type {AppRow} from '../core/runtime.js';
import {projectPullRequest, projectWorktreeListRow, sanitizeInlineText} from '../core/worktree-projection.js';
import {getScrollbarThumbRows, sliceListViewport} from '../terminal/viewport.js';

const MIN_BRANCH_WIDTH = 24;
const PULL_REQUEST_ICONS = {
	OPEN: '\u{f407}', // Nerd Font nf-oct-git_pull_request
	DRAFT: '\u{f4dd}', // Nerd Font nf-oct-git_pull_request_draft
	CLOSED: '\u{f4dc}', // Nerd Font nf-oct-git_pull_request_closed
	MERGED: '\u{f419}', // Nerd Font nf-oct-git_merge
} as const;
type RowColor = 'cyan' | 'green' | 'red' | undefined;
type PullRequestIndicatorColor = 'green' | 'yellow' | 'red' | 'magenta' | undefined;

function getIndicator(state: ReturnType<typeof projectWorktreeListRow>['state']): string {
	if (state === 'active') {
		return '*';
	}
	if (state === 'invalid') {
		return '!';
	}
	if (state === 'external') {
		return '^';
	}
	return '-';
}

function getRowColor(projection: ReturnType<typeof projectWorktreeListRow>): RowColor {
	if (projection.state === 'active') {
		return 'green';
	}
	if (projection.isSelected) {
		return 'cyan';
	}
	if (projection.state === 'invalid') {
		return 'red';
	}
	return undefined;
}


function truncateLabel(value: string, width: number): string {
	if (value.length <= width) {
		return value;
	}
	return `${value.slice(0, Math.max(width - 1, 0))}…`;
}


export function WorktreeList({
	rows,
	selectedIndex,
	width,
	height,
	stacked,
	scrollOffset = 0,
	filterQuery = '',
	isFilterInputOpen = false,
	totalRowCount = rows.length,
}: {
	rows: AppRow[];
	selectedIndex: number;
	width?: number;
	height?: number;
	stacked: boolean;
	scrollOffset?: number;
	filterQuery?: string;
	isFilterInputOpen?: boolean;
	totalRowCount?: number;
}) {
	const branchWidth = Math.max(MIN_BRANCH_WIDTH, (width ?? 34) - 9);
	const viewport = sliceListViewport(rows, height === undefined ? rows.length : height - 3, scrollOffset);
	const contentViewportHeight = viewport.viewportHeight;
	const effectiveScrollOffset = viewport.scrollOffset;
	const visibleRows = viewport.visibleItems;
	const showScrollbar = height !== undefined && rows.length > contentViewportHeight;
	const scrollbarThumbRows = showScrollbar ? getScrollbarThumbRows(rows.length, contentViewportHeight, effectiveScrollOffset) : new Set<number>();
	const hasFilter = filterQuery.trim() !== '';
	const filterText = sanitizeInlineText(filterQuery);
	const title = hasFilter || isFilterInputOpen
		? `Worktrees /${filterText}${isFilterInputOpen ? '█' : ''} (${rows.length}/${totalRowCount})`
		: 'Worktrees';

	return (
		<Box
			width={width}
			height={height}
			flexGrow={stacked ? 0 : 1}
			marginRight={stacked ? 0 : 1}
			borderStyle="round"
			borderColor="cyan"
			flexDirection="column"
			paddingX={1}
			overflowY="hidden"
		>
			<Text bold color="cyan" wrap="truncate-end">
				{title}
			</Text>
			{rows.length === 0 ? (
				<Text dimColor wrap="truncate-end">
					No worktrees match filter.
				</Text>
			) : null}
			{visibleRows.map((row, index) => {
				const isSelected = index + effectiveScrollOffset === selectedIndex;
				const projection = projectWorktreeListRow(row, isSelected);
				const tagSuffix = projection.isMain ? ' [root]' : '';
				const color = getRowColor(projection);
				const branchText = sanitizeInlineText(row.branch);
				const pullRequest = projectPullRequest(row);
				const pullRequestIcon = pullRequest.kind === 'found'
					? pullRequest.isDraft ? PULL_REQUEST_ICONS.DRAFT : PULL_REQUEST_ICONS[pullRequest.state]
					: undefined;
				const pullRequestIndicatorColor: PullRequestIndicatorColor = pullRequest.kind !== 'found'
					? undefined
					: pullRequest.isDraft
						? 'yellow'
						: pullRequest.state === 'OPEN'
							? 'green'
							: pullRequest.state === 'CLOSED' ? 'red' : 'magenta';
				const branchLabel = `${truncateLabel(branchText, Math.max(1, branchWidth - tagSuffix.length))}${tagSuffix}`;
				return (
					<Box key={row.path} flexDirection="row">
						<Box flexGrow={1} flexShrink={1}>
							<Text
								key={row.path}
								color={color}
								dimColor={!isSelected && color === undefined}
								bold={projection.state === 'active'}
								wrap="truncate-end"
							>
								{`${isSelected ? '>' : ' '} ${getIndicator(projection.state)} `}
								{pullRequestIcon === undefined ? ' ' : (
									<Text color={pullRequestIndicatorColor} dimColor={false}>
										{pullRequestIcon}
									</Text>
								)}
								{` ${branchLabel}`}
							</Text>
						</Box>
						{showScrollbar ? (
							<Text color={scrollbarThumbRows.has(index) ? 'cyan' : 'gray'} dimColor={!scrollbarThumbRows.has(index)}>
								{scrollbarThumbRows.has(index) ? '█' : '│'}
							</Text>
						) : null}
					</Box>
				);
			})}
		</Box>
	);
}
