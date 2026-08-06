# Worktree Runner TUI

`worktree-runner-tui` is a terminal UI for running and managing Git worktree sessions from inside a repository.
It keeps one active runtime session per namespace, lets you switch worktrees with the keyboard, and keeps logs/process cleanup tied to the repo's shared Git state.

<img width="1023" height="582" alt="image" src="https://github.com/user-attachments/assets/ef33c2aa-0af4-4701-b1ec-fa9289e8ee3a" />


## Features

- Discover worktrees from the current repository even when launched from a subdirectory
- Start, switch, or restart the active worktree session with `Enter`
- Stop the active session and clean up recorded orphan processes with `s`
- Run an optional per-worktree setup command with `i`
- Open the selected worktree in your editor with `e`
- Open the selected branch's pull request in a browser with `o`
- Delete a non-root worktree from the TUI with `d`, then confirm
- Inspect branch, upstream, working tree, and pull request metadata in the detail pane
- Show a Nerd Font pull request indicator next to branches with detected PR metadata
- Tail ANSI-colored logs inline or in a full-screen log view
- Generate and load JSONC config with comments and trailing commas

## Requirements

- Node.js `>=20`
- Git
- A Git repository (additional linked worktrees optional)
- Optional: GitHub CLI (`gh`) and a GitHub origin remote for pull request metadata and `o` / Open PR
- Recommended: a Nerd Font terminal font for the GitHub pull request indicator (``) in the Worktree list

## Installation

```bash
npm install -g @ohzw/worktree-runner-tui
```

Installed binary: `wtr`

### Migrating from `@ohzw/worktree-command-tui`

The renamed npm package is published separately. Replace the old global installation:

```bash
npm uninstall -g @ohzw/worktree-command-tui
npm install -g @ohzw/worktree-runner-tui
```

Existing `.worktree-command-tui.jsonc` and `.worktree-command-tui.json` files remain supported. New configuration is written as `.worktree-runner-tui.jsonc`.
Session records and logs keep their existing Git common-dir location so an in-flight session remains controllable after upgrading.

## Quick start

### 1) Initialize config

Run this from the repo root or any subdirectory inside the repo:

```bash
wtr init
```

This writes `.worktree-runner-tui.jsonc` at the repository root.

To overwrite an existing config:

```bash
wtr init --force
```

### 2) Start the TUI

```bash
wtr
```

If config is missing, the CLI exits with a message telling you to run `wtr init`.

## Keyboard shortcuts

Primary shortcuts in the footer:

- `↑↓` / `j` `k` — move selection
- `Enter` — start, switch to, or restart the selected worktree
- `i` — run `setupCommand` when configured
- `e` — open the selected worktree in the configured editor when `editorCommand` is configured
- `o` — open the selected worktree's pull request when GitHub metadata is available
- `d` — arm worktree deletion
- `L` — open full-screen logs
- `s` — stop active session
- `r` — refresh worktree metadata
- `?` — show help
- `q` — quit

Additional shortcuts from the help window:

- `g` / `G` — jump to first / last worktree
- `[` / `]` — scroll logs
- `PageUp` / `PageDn` — page the selection list
- Mouse wheel — scroll the pane under the cursor
- `d` / `y` — confirm delete after arming it
- `Esc` / `n` / `q` — cancel delete confirmation

## Security and network behavior

`wtr` executes the argv commands stored in the selected configuration file when you press the matching keys. Treat repository config as trusted code:

- `Enter` starts `command` in the selected worktree; pressing it on the active worktree restarts that session.
- `i` runs `setupCommand`; package-manager install commands may run dependency lifecycle scripts.
- `e` runs `editorCommand` with the selected worktree path appended.

Review config before using those actions in an untrusted repository or worktree.

The TUI also reads pull request metadata with the GitHub CLI when `remote.origin.url` points at `github.com`. This uses `gh api`, your existing `gh` authentication, and a short timeout. Non-GitHub remote hosts are ignored by default.

## Configuration

The tool looks for config in this order:

1. `.worktree-runner-tui.jsonc`
2. `.worktree-runner-tui.json`
3. `.worktree-command-tui.jsonc` (legacy)
4. `.worktree-command-tui.json` (legacy)

Example config:

```jsonc
{
  // Session namespace used for git-common-dir state files and logs.
  "namespace": "worktree-runner-tui",

  // Command launched in the selected worktree.
  "command": ["npm", "run", "dev"],

  // Optional command run manually with the setup key in the selected worktree.
  "setupCommand": ["npm", "install"],

  // Optional command that opens the selected worktree path in an editor.
  // The selected worktree path is appended as the final argv entry.
  "editorCommand": ["code"],

  // TCP ports owned by the command, used when stopping stale/orphaned processes.
  "ports": [3000],

  // Files that must exist in a worktree before the command can be started there.
  "requiredFiles": ["package.json"],

  // Extra process command-line substrings treated as orphans for cleanup.
  "orphanMatchers": []
}
```

Notes:

- `setupCommand` is optional and never runs automatically; `i` only appears when it is configured. It accepts one argv array or an array of argv arrays executed in order. The built-in `["copy-root-file", "source", "destination"]` copies from the repo root into the selected worktree.
- `editorCommand` is optional; when set, the selected worktree path is appended to the argv and `e` becomes available
- Use `ports` for every backend/frontend/dev-server port the command may bind; legacy single `port` configs still load
- The generated default config auto-detects package manager hints from `packageManager` or common lockfiles and chooses a default script such as `dev`, `start`, or `serve`
- Session records and logs are stored under the repository's Git common dir, so they are shared across worktrees in the same repo

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

## License

MIT
