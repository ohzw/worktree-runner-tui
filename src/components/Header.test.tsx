import React, {type ReactNode} from 'react';
import {describe, expect, it} from 'vitest';
import {Header} from './Header.js';

function textContent(node: ReactNode): string {
	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map(child => textContent(child)).join('');
	}
	if (React.isValidElement<{children?: ReactNode}>(node)) {
		return textContent(node.props.children);
	}
	return '';
}

describe('Header', () => {
	it('renders the minimal repository and integrated status summary safely', () => {
		const tree = Header({
			repoName: 'repo\u001b]0;owned\u0007\nnext',
			activeBranch: 'feat/\u001b[2Jbad\u202E',
			status: {kind: 'error', message: 'failed\u001b]0;owned\u0007\nnext\u202E'},
		});
		const text = textContent(tree);

		expect(text).toContain('Repo: repo next');
		expect(text).toContain('✘ Error · feat/bad — failed next');
		expect(text).not.toContain('Worktree Runner TUI');
		expect(text).not.toContain('Namespace:');
		expect(text).not.toContain('\u001b');
		expect(text).not.toContain('owned');
		expect(text).not.toContain('\u202E');
	});

	it('merges the active branch into running status without repeating the message', () => {
		const tree = Header({
			repoName: 'repo',
			activeBranch: 'feat/a',
			status: {kind: 'running', message: 'Active: feat/a'},
		});

		expect(textContent(tree)).toContain('✓ Running: feat/a');
		expect(textContent(tree)).not.toContain('Active: feat/a');
	});
});
