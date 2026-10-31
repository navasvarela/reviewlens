# Configuration

## Command options

| Option | Used with | What it does |
| --- | --- | --- |
| `--out <dir>` | `review` | Writes the report here instead of the cache folder |
| `--port <number>` | `review`, `app` | Sets the local port. `review` picks a free one; `app` uses 4317 |
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
| `GITHUB_TOKEN`, `GH_TOKEN` | Token for GitHub and GitHub Enterprise |
| `GITLAB_TOKEN` | Token for GitLab, including self-managed |
| `ANTHROPIC_API_KEY` | Credential for `--ai`, unless you use an `ant auth login` profile |
| `XDG_CACHE_HOME` | Moves the cache from `~/.cache/lens` |
| `XDG_DATA_HOME` | Moves the app's data from `~/.local/share/lens` |

> [!WARNING]
> Lens sends these tokens to the host named in the link you give it, including self-managed hosts. Only use links to hosts you trust while a token is set.

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
| GitHub or GitLab | Your token, to read the PR and its code | Always |
| OSV | Names and versions of dependencies | Unless `--offline` |
| Semgrep registry | A rule download; your code isn't uploaded | When Semgrep is installed, unless `--offline` |
| Anthropic | The changed code, and the PR's title and description | Only with `--ai` |

## Where Lens keeps files

| Path | Contents | Safe to delete? |
| --- | --- | --- |
| `~/.cache/lens` | Cached repositories, reports and AI results | Yes. It's rebuilt on the next run, though existing report links in the app stop working until you refresh those reviews |
| `~/.local/share/lens/lens.db` | The app's review list | Only if you want an empty list |
