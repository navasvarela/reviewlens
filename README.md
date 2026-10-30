# lens

A review companion for GitHub pull requests and GitLab merge requests. `lens review <url>` fetches the
change, analyzes it, and serves a local report. (Working name; the project name is still an open decision.)

Status: milestones M0 and M1. Blast radius, risk and the AI layer come in M2–M4.

## What the report shows

- **Changed units, not hunks.** For Rust, TypeScript/JavaScript and Python, each changed function, method,
  type or class appears once, whole, before and after, with edited words marked. A class shows only the
  code it owns; its methods are separate cards.
- **Noise collapsed.** Formatting-only and comment-only edits, renames with unchanged bodies, and units moved
  unchanged between files or containers are folded away. Lockfiles, vendored and generated files (by path
  or a `@generated` / `DO NOT EDIT` header) are grouped as skippable.
- **Line diff fallback** for other languages, skipped files, and on demand.

Known limits: changes inside test callbacks such as `describe(...)`/`it(...)` show under "imports & top
level"; a unit both moved and edited shows as removed plus added; no syntax highlighting yet.

## Usage

Requires Node.js 22.18 or newer (it runs the TypeScript sources directly), pnpm and git.

```sh
pnpm install
pnpm build:ui
pnpm lens review https://github.com/owner/repo/pull/123
pnpm lens review https://gitlab.com/group/project/-/merge_requests/45 --no-serve --out ./report
```

Set `GITHUB_TOKEN` (or `GH_TOKEN`) and `GITLAB_TOKEN` for private repositories and higher API rate limits.
GitHub Enterprise and self-managed GitLab work by URL. Run `pnpm lens --help` for all options.

## How it works

1. **Providers** (`packages/providers`) parse the URL and read the PR from the host's API, including its merge base.
2. **Engine** (`packages/engine`) fetches only the merge-base and head commits (depth 1) into a cached bare
   repository under `~/.cache/lens/repos`, builds the file list and hunks from `git diff`, classifies noise,
   and parses both versions of each file with tree-sitter (WASM) to extract and compare units
   (`src/syntax`: one small spec per language, a shared walker, token fingerprints for comparison).
3. The **review model** (`packages/review-model`) is the JSON contract between the engine and every
   consumer, validated with Zod on both sides.
4. The **CLI** (`packages/cli`) writes the report (the prebuilt UI plus `review.json`) as a static directory
   and serves it on `127.0.0.1`. The directory can also be uploaded as a CI artifact as is.
5. The **report UI** (`packages/report-ui`) is a React app built with Vite.

## Development

```sh
pnpm typecheck
pnpm test
pnpm --filter @lens/report-ui dev   # needs a review.json in packages/report-ui/public
```
