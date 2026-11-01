# Configuration

## Command options

| Option | Used with | What it does |
| --- | --- | --- |
| `--out <dir>` | `review` | Writes the report here instead of the cache folder |
| `--port <number>` | `review`, `app` | Sets the local port. `review` uses 4318, or any free port if that is taken; `app` uses 4317 |
| `--no-serve` | `review` | Writes the report and exits |
| `--offline` | `review`, `app` | Skips OSV lookups, Semgrep and osv-scanner |
| `--ai` | `review` | Adds an AI review, which sends the changed code to Anthropic |
| `--ai-model <id>` | `review` | Sets the model (default `claude-opus-5-5`) |
| `--ai-max-input-tokens <n>` | `review` | Caps the prompt (default 40,000); larger PRs are summarized |
| `--cache-dir <dir>` | `review`, `app` | Sets where repositories and reports are cached |
| `--data-dir <dir>` | `app` | Sets where the review list is stored |
| `--report <dir>` | `comment` | The folder `review` wrote with `--out` |
| `--report-url <url>` | `comment` | Where reviewers can open the report |

## Environment variables

| Variable | What it does |
| --- | --- |
| `GITHUB_TOKEN`, `GH_TOKEN` | Token for GitHub, and GitHub Enterprise once it's trusted |
| `GITLAB_TOKEN` | Token for GitLab, and self-managed GitLab once it's trusted |
| `LENS_TRUSTED_GITHUB_HOSTS`, `LENS_TRUSTED_GITLAB_HOSTS` | Hosts besides github.com and gitlab.com that may receive those tokens |
| `ANTHROPIC_API_KEY` | Credential for `--ai`, unless you use an `ant auth login` profile |
| `XDG_CACHE_HOME` | Moves the cache from `~/.cache/lens` |
| `XDG_DATA_HOME` | Moves the app's data from `~/.local/share/lens` |

### Tokens and trusted hosts

Lens only sends tokens to `https://github.com`, `https://gitlab.com` and hosts you've added. For any other host, it reads the link without a token, which works for public repositories. A `GITHUB_TOKEN` goes only to GitHub hosts and a `GITLAB_TOKEN` only to GitLab hosts.

To use GitHub Enterprise or self-managed GitLab, add your host:

```bash
export LENS_TRUSTED_GITHUB_HOSTS=git.acme.internal
export LENS_TRUSTED_GITLAB_HOSTS=gitlab.acme.internal,gitlab.acme.dev:8443
```

| Rule | Why |
| --- | --- |
| A bare host means https | A token never goes over plain http unless you write `http://host` in the list |
| Each trusted host of a kind receives the same token | Set the variable to a token meant for the host you're reviewing, not your github.com token |
| The list can't be set in `.lens.json` | That file belongs to the repository the token would be sent to |
| No setup is needed in CI | A job trusts its own server, from `GITHUB_SERVER_URL` or `CI_SERVER_URL` |

In the app, a GitHub CLI login is used for github.com and for hosts in the list.

## Team rules: `.lens.json`

Put this file at the root of the repository being reviewed. Every setting is optional.

```json
{
  "riskPaths": [{ "pattern": "src/ledger/**", "severity": "high", "reason": "Moves customer funds" }],
  "ignore": ["tests/fixtures/**"],
  "ai": { "allowed": true },
  "scanners": { "semgrep": { "rules": ["p/default"] } },
  "feedback": { "url": "https://forms.example.com/reviewlens" }
}
```

| Setting | What it does |
| --- | --- |
| `riskPaths` | Marks sensitive areas. `severity` is `high`, `medium` or `low`, and `reason` appears in the finding |
| `ignore` | Leaves these paths out of the risk checks. The report says how many files were left out |
| `ai.allowed` | Set to `false` to block AI review for the repository |
| `scanners.semgrep.rules` | Sets Semgrep registry rule packs (`p/…` or `r/…`). Use an empty list to turn Semgrep off |
| `feedback.url` | Adds a feedback link to the report and the PR comment |

**A PR can't change its own rules.** Lens reads this file from the PR's merge base, so an edit takes effect only after it's merged. The edit itself is reported as a finding. AI review is blocked if either version of the file forbids it.

## What leaves your machine

| Destination | What is sent | When |
| --- | --- | --- |
| The PR's host | Your token, if the host is trusted, to read the PR and its code | Always |
| OSV | Names and versions of dependencies | Unless `--offline` |
| Semgrep registry | A rule download; your code isn't uploaded | When Semgrep is installed, unless `--offline` |
| Anthropic | The changed code, and the PR's title and description, with known credential formats redacted and credential files left out | Only with `--ai` |

## Where Lens keeps files

| Path | Contents | Safe to delete? |
| --- | --- | --- |
| `~/.cache/lens` | Cached repositories, reports and AI results | Yes. It's rebuilt on the next run, though existing report links in the app stop working until you refresh those reviews |
| `~/.local/share/lens/lens.db` | The app's review list | Only if you want an empty list |
