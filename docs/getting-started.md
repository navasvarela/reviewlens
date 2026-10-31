# Getting started

## Install

You need Node.js 22.18 or newer, pnpm and git.

```bash
git clone https://github.com/navasvarela/reviewlens.git
cd reviewlens
pnpm install
```

Run every `pnpm lens` command from this folder.

## Your first report

```bash
pnpm lens review https://github.com/owner/repo/pull/123
```

Lens fetches the change, analyzes it and prints a local address to open. GitLab works the same way, with a merge request link. Press Ctrl+C when you are done.

The report has four tabs:

- **Changes**: each changed function or type, whole, before and after.
- **Impact**: where other code uses what changed, and which of those callers the PR did not touch.
- **Risks**: the security level, the findings, the checks that ran and the checks that did not.
- **AI review**: a reading order and questions, only if you ask for it with `--ai`.

A low security level means the checks that ran found nothing. It doesn't mean the change is safe, so look at "Not checked" too.

## Private repositories

Lens needs a token that can read the repository. If you use the GitHub CLI:

```bash
GH_TOKEN=$(gh auth token) pnpm lens review https://github.com/owner/repo/pull/123
```

For GitLab, create a token with the `read_api` and `read_repository` scopes:

```bash
GITLAB_TOKEN=<token> pnpm lens review https://gitlab.com/group/project/-/merge_requests/123
```

## Keep track of several reviews

```bash
pnpm lens app
```

This runs a list at `http://127.0.0.1:4317/`, which you open in your browser. Paste a link to add a review. If you're signed in with the GitHub CLI, the app uses that login for GitHub. For GitLab, set `GITLAB_TOKEN` before starting it.

## Add more checks

These are optional. Without them, Lens still runs its built-in rules and lists what it skipped.

```bash
brew install semgrep gitleaks osv-scanner
```

## Next steps

- [Set options and team rules](configuration.md)
- [Add Lens to CI](pilot.md)
- [Fix a problem](troubleshooting.md)
