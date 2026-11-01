# Changelog

## Unreleased

- **Renamed to Walkdiff.** The command is now `pnpm walkdiff`, the config file is `.walkdiff.json`, and the trusted hosts variables are `WALKDIFF_TRUSTED_GITHUB_HOSTS` and `WALKDIFF_TRUSTED_GITLAB_HOSTS`. An existing `.lens.json` keeps working, but the old variables don't, so set the new ones or tokens won't be sent to those hosts. Saved reviews aren't moved, so the app starts with an empty list.
- **Code quality:** Walkdiff flags complexity, long functions and lint problems in the code a PR adds, using built-in measures and optional Ruff, oxlint and jscpd. Findings appear as reasons on the review path and never change the security level.

## 0.1.0

The first release, published under the name Lens. Walkdiff is early software, so expect changes, and it hasn't had an independent security audit.

### The review

- **Guided review:** the report opens on a brief with what to check and where to start, then takes you through the changes that matter most, explaining why each one is there.
- **Progress and comments:** mark changes as reviewed and leave comments, on the path or in All changes. Both are saved in your browser, by commit. Comments can be copied for the PR, but aren't posted to it yet.
- **Whole functions:** each changed function or type appears whole, before and after, for Rust, TypeScript, JavaScript and Python. Other languages get a line diff.
- **Impact:** where the rest of the code uses what changed, and which callers the PR didn't touch.
- **Risks:** a security level, built-in rules for secrets, risky APIs and sensitive areas, and known vulnerabilities through OSV.
- **Security scanners:** optional Semgrep, gitleaks and osv-scanner.
- **AI review:** optional reading order, description check and questions. Nothing is sent without `--ai`.

### Using it

- `walkdiff review` for a single report, and `walkdiff app` to keep track of several reviews.
- A GitHub Action and a GitLab CI template that add a report and a summary comment to each PR.
- Team rules in `.walkdiff.json`, read from the merge base so a PR can't change its own rules.

### Security

- Tokens go only to github.com, gitlab.com and hosts you trust.
- Pull request code is never built or run.
- See [SECURITY.md](SECURITY.md) for the guarantees and their limits.

### Known limits

- Not yet tried against a real GitLab merge request, GitHub Enterprise, self-managed GitLab or a live AI review.
- The review path's ranking uses simple rules, and hasn't been tested with reviewers yet. It can rank an important change too low, so use All changes when in doubt.
- Progress doesn't carry over to a new push.
