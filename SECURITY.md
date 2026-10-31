# Security policy

Lens reads private code and uses tokens that can reach it, so you should be able to check what it does with both. This page says what Lens guarantees, what it doesn't, and how to verify it.

> **Status: draft.** Lens is pre-release software and hasn't had an independent security audit.

## Reporting a vulnerability

[Report it privately through GitHub](https://github.com/navasvarela/reviewlens/security/advisories/new). Please don't open a public issue, and leave real secrets and private code out of your report.

Lens is maintained by one person, so these are goals, not contractual promises:

| Step | Goal |
| --- | --- |
| First reply | 3 working days |
| Assessment | 10 working days |
| Fix for a confirmed high or critical issue | 30 days |

Only the latest commit on `main` is supported until versioned releases exist. Testing against your own installation is welcome. Please don't test against other people's repositories, accounts or reports.

## What Lens guarantees

Each guarantee describes the code on `main` and has an automated test or setting behind it.

### Your code

| Guarantee | How it's enforced |
| --- | --- |
| Lens never builds, installs or runs code from a PR | It only reads commits from a bare repository and parses them. The GitHub Action doesn't check out the PR |
| Code isn't sent to any AI service unless you ask | AI review needs `--ai`, or the checkbox in the app |
| A repository can forbid AI review | `"ai": { "allowed": false }` in `.lens.json`. A PR can't remove this, because if either version forbids it, it's blocked |
| Lens has no telemetry and no server of its own | It collects no usage data, and the only network destinations are listed below |
| A report can't contact anything | Every report carries a Content Security Policy that blocks network requests, so script injected through a PR has nowhere to send data |
| Local servers aren't reachable from your network | They listen only on `127.0.0.1` and refuse other host names, which blocks DNS rebinding |
| Local files are private to your user account | Reports, cached repositories and the review list are created for your user only, and the default folders are closed to other users |

### Your credentials

| Guarantee | How it's enforced |
| --- | --- |
| A token only goes to hosts you trust | `github.com`, `gitlab.com` and hosts you list. See [trusted hosts](docs/configuration.md#tokens-and-trusted-hosts) |
| A token doesn't go to the wrong kind of host, or over plain http | Whole origins are compared, for each kind of token |
| A redirect can't carry a token to another host | Lens refuses cross-host API redirects, and git doesn't follow redirects while it holds a token |
| Tokens stay out of command lines and repository config | They reach git through its environment |
| Third-party scanners don't get your tokens | They run with a minimal environment, on a temporary copy of the changed files |
| Lens doesn't store your tokens | It reads them from the environment or the GitHub CLI each time |

### Secrets in pull requests

| Guarantee | How it's enforced |
| --- | --- |
| Findings don't show a detected secret | Evidence is redacted in the report and left out of the PR comment |
| Known credential formats are redacted from AI prompts | Prompts pass through redaction just before sending, including private key bodies |
| Credential files aren't sent to AI at all | `.env`, `*.pem`, `*.key`, `.npmrc` and similar are left out by name |

### Tampering with results

| Guarantee | How it's enforced |
| --- | --- |
| A PR can't relax its own rules | `.lens.json` is read from the merge base, and editing it is itself a finding |
| A PR can't silence scanners | Suppression comments are ignored, and scanner config files in the PR aren't used |
| A PR can't instruct the AI to act | The AI has no tools and can only return a structured review. Every statement must cite lines it was shown, and the rest is discarded |

## What Lens doesn't guarantee

- **A low security level doesn't mean a change is safe.** It means the checks that ran found nothing. The report lists the ones that didn't run.
- **Secret detection isn't complete.** Redaction recognises known formats and common assignments. A secret in an unusual format can still reach an AI prompt, so don't use `--ai` on a PR you know contains secrets.
- **The Changes tab shows the code as it is.** A secret in a PR is redacted from findings, but still appears in the diff, in the report and in `review.json`.
- **Prompt injection can mislead the AI review.** Someone writing a PR can try to influence what it says, so treat its output as a hint and not as a verdict.
- **Reference finding is by name and syntax,** so the Impact tab can miss callers or match the wrong ones.
- **Lens doesn't protect you from your own machine.** Files are stored unencrypted, and anything running as your user can read them.

## What leaves your machine

| Destination | What is sent | When | How to stop it |
| --- | --- | --- | --- |
| The PR's host | Your token if the host is trusted, and requests for the PR and its code | Always | - |
| [OSV](https://osv.dev) | Names and versions of dependencies changed in the PR, **including private package names** | By default | `--offline` |
| Semgrep registry | A rule download; code isn't uploaded | If Semgrep is installed | `--offline`, or an empty rule list |
| Anthropic | Changed code, and the PR's title and description | Only with `--ai` | Leave `--ai` off, or forbid it in `.lens.json` |

For how Anthropic handles API data, see [its privacy documentation](https://privacy.anthropic.com).

## The report in CI

The report isn't hosted by Lens. It's a single HTML file stored by your own CI system.

| | GitHub Actions | GitLab CI |
| --- | --- | --- |
| **Stored as** | A workflow artifact, in GitHub's storage | A job artifact, on your GitLab instance |
| **Private repository** | People with read access to the repository | Depends on the project's job artifact access |
| **Public repository** | **Any signed-in GitHub user** | **Public, unless you restrict it** |
| **Kept for** | 14 days, set with `retention-days` | 14 days, set with `expire_in` |

For the people who can already read the repository, the report adds little exposure, but keep these in mind:

- **Public repositories:** reports are effectively public. That includes any AI review output, so assume anything in the PR is public too.
- **Secrets stay until the artifact expires:** removing a secret from a PR doesn't remove it from reports already generated. If a secret was committed, revoke it, then delete the workflow run's artifact.
- **The download address:** when someone signed in opens the link, GitHub redirects to a temporary storage address. Anyone who has that address can use it until it expires, so don't paste it anywhere.
- **Downloaded copies:** a report someone saved stays on their machine, with no expiry and no access control.
- **The PR comment:** it shows finding titles and file paths, never code or evidence. Everyone who can see the PR sees it, and it may reach them by email.
- **GitLab:** check the project's visibility and its [job artifact settings](https://docs.gitlab.com/ci/jobs/job_artifacts/), especially "Public pipelines".

## Using Lens safely in CI

- **Pin the action to a full commit SHA**, not `@main`, so a later change can't reach your CI without your review.
- **Use the narrowest token.** The default `github.token` with `contents: read` and `pull-requests: write` is enough.
- **Don't use `pull_request_target`.** Use `on: pull_request`, as in the [pilot guide](docs/pilot.md).
- **Keep the Anthropic key out of fork PRs.** GitHub doesn't give secrets to `pull_request` runs from forks by default, so keep it that way.

## How the project is built

| Measure | Status |
| --- | --- |
| Signed commits required on `main` | On, enforced by a repository ruleset |
| Changes to `main` go through a pull request; no force-push or deletion | On |
| CodeQL code scanning | On |
| GitHub secret scanning and push protection | On |
| Dependabot alerts | On |
| Lockfile enforced in CI (`--frozen-lockfile`) | On |
| Dependency install scripts blocked | On, pnpm's default |
| GitHub Actions pinned to commit SHAs | On |
| Default workflow token is read-only | On |

**Commit history:** `main` includes early commits that are unsigned, or signed with a key GitHub doesn't recognise. The signing requirement applies to new commits, because rewriting published history would break existing links.
