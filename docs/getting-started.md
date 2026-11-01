# Getting started

## Install

You need Node.js 22.18 or newer, pnpm and git.

```bash
git clone https://github.com/navasvarela/walkdiff.git
cd walkdiff
pnpm install
```

Run every `pnpm walkdiff` command from this folder.

## Your first report

```bash
pnpm walkdiff review https://github.com/owner/repo/pull/123
```

Walkdiff fetches the change, analyzes it and prints a local address to open. GitLab works the same way, with a merge request link. Press Ctrl+C when you are done.

The report opens on a brief, with what to check and where to start:

1. **Start the review.** Walkdiff takes you through the changes that matter most, one at a time, and says why each one is there.
2. **Mark what you've reviewed** and leave comments as you go. The side panel shows your progress and links to every change.
3. **Finish.** The last screen shows what you reviewed, what's left, and what Walkdiff couldn't check. In the app, you can post your review from here. Elsewhere, copy your comments.

Everything else is under **All changes**:

- **Changes:** each changed function or type, whole, before and after.
- **Impact:** where other code uses what changed, and which of those callers the PR did not touch.
- **Risks:** the security level, the findings, the checks that ran and the checks that did not.
- **AI review:** a reading order and questions, only if you ask for it with `--ai`.

A low security level means the checks that ran found nothing. It doesn't mean the change is safe, so look at "Not checked" too.

## Private repositories

Walkdiff needs a token that can read the repository. If you use the GitHub CLI:

```bash
GH_TOKEN=$(gh auth token) pnpm walkdiff review https://github.com/owner/repo/pull/123
```

For GitLab, create a token with the `read_api` and `read_repository` scopes:

```bash
GITLAB_TOKEN=<token> pnpm walkdiff review https://gitlab.com/group/project/-/merge_requests/123
```

## Keep track of several reviews

```bash
pnpm walkdiff app
```

This opens a list at `http://127.0.0.1:4317/` in your browser. Use `--no-open` to leave your browser alone. Paste a link to add a review. If you're signed in with the GitHub CLI, the app uses that login for GitHub. For GitLab, set `GITLAB_TOKEN` before starting it.

## Post your review

In the app, the finish screen posts your comments and your decision to the PR: Comment, Approve or Request changes. The Conversation tab shows existing threads, where you can reply and resolve them. Nothing is posted until you press the button.

Your token needs write access: `pull-requests: write` on GitHub, or the `api` scope on GitLab. A GitHub CLI login usually already has it.

## Show test evidence

Give Walkdiff a coverage report from your tests, in LCOV or Cobertura format, and each change shows whether its changed lines ran. Changes whose lines didn't run rank higher.

```bash
pnpm walkdiff review https://github.com/owner/repo/pull/123 --coverage coverage/lcov.info
```

Generate the report from the PR's latest commit, or the line numbers won't match. In CI, use the Action's `coverage-file` input or the GitLab template's `WALKDIFF_COVERAGE` variable. The local app can't read reports yet.

## Add more checks

These are optional. Without them, Walkdiff still runs its built-in rules and lists what it skipped.

```bash
brew install semgrep gitleaks osv-scanner
```

## Next steps

- [Set options and team rules](configuration.md)
- [Add Walkdiff to CI](pilot.md)
- [Fix a problem](troubleshooting.md)
