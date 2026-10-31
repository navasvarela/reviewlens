# lens

A review companion for GitHub pull requests and GitLab merge requests. `lens review <url>` fetches the
change, analyzes it, and serves a local report. (Working name; the project name is still an open decision.)

Status: milestones M0–M5. To run it on your team's PRs, see the [pilot guide](docs/pilot.md).

**Documentation:** [getting started](docs/getting-started.md), [configuration](docs/configuration.md), [troubleshooting](docs/troubleshooting.md), [security policy](SECURITY.md).

## What the report shows

The report has four tabs: **Changes** (files, the map of each file and the changed units), **Impact** (where other code uses what changed), **Risks** (security level, findings and what was not checked) and **AI review**. Each tab shows a count, and its name in the URL lets you link to it, as in `#risks`.

- **Changed units, not hunks.** For Rust, TypeScript/JavaScript and Python, each changed function, method,
  type or class appears once, whole, before and after, with edited words marked. A class shows only the
  code it owns; its methods are separate cards.
- **A map of each file.** When a file has several changed units, an outline shows which ones changed among all its definitions, how big they are, and which changed function calls which. Cards are in reading order: types first, then helpers before the code that calls them, with collapsed changes last.
- **Change facts.** Each modified function lists what changed without reading it, worked out from the syntax: parameters, return type, calls added or removed, and more or fewer error paths and branches.
- **Noise collapsed.** Formatting-only and comment-only edits, renames with unchanged bodies, and units moved
  unchanged between files or containers are folded away. Lockfiles, vendored and generated files (by path
  or a `@generated` / `DO NOT EDIT` header) are grouped as skippable.
- **Blast radius.** For every function, method or type the PR changes, removes or renames, the report
  lists where the rest of the code still uses it, linked to the host at the head commit, and flags the
  callers this PR did not touch. Removed and renamed units show any references left behind.
- **Risks and a security level.** Built-in rules flag likely secrets (redacted in the report), risky APIs
  such as `eval`, `shell=True`, raw HTML or `unsafe` (only in code, not comments or strings), sensitive
  areas such as auth, payments, migrations and CI, new dependencies, and known vulnerabilities in
  dependency versions new to `package-lock.json`, `Cargo.lock`, `poetry.lock`, `uv.lock` or pinned
  requirements (via [OSV](https://osv.dev); `--offline` skips it). Review signals add large PRs, missing
  test changes and removed or renamed units that untouched code still uses. The security level is the
  highest severity among security findings, and the report lists the checks that ran and those that did
  not. [Security scanners](#security-scanners) add more when installed.
- **AI review (opt-in, `--ai`).** A suggested reading order that groups the changed units into chapters,
  a check of the PR description against the code (matches, contradicts, not in the description, not found),
  and specific questions to answer before approving. Every statement must cite lines of the change; the
  engine checks each citation against what the model was shown and discards the rest. Results are cached
  per prompt, and the report shows tokens used and the estimated cost.
- **Line diff fallback** for other languages, skipped files, and on demand.

References are found by name and syntax, not type resolution: each carries a confidence (exact when
qualified with the unit's type, likely for a direct use, possible for `x.method()` on an unknown type),
and parameters or locals that shadow the name are ignored. Names in more than 200 files (`new`, `get`)
are reported as too common to trace.

Known limits: changes inside test callbacks such as `describe(...)`/`it(...)` show under "imports & top
level"; a unit both moved and edited shows as removed plus added; no syntax highlighting yet.

## Usage

Requires Node.js 22.18 or newer (it runs the TypeScript sources directly), pnpm and git.

```sh
pnpm install
pnpm lens review https://github.com/owner/repo/pull/123
pnpm lens review https://gitlab.com/group/project/-/merge_requests/45 --no-serve --out ./report
```

Set `GITHUB_TOKEN` (or `GH_TOKEN`) and `GITLAB_TOKEN` for private repositories and higher API rate limits.
GitHub Enterprise and self-managed GitLab work by URL; tokens go to them only once they're [trusted](docs/configuration.md#tokens-and-trusted-hosts). Run `pnpm lens --help` for all options.

## Keep track of several reviews

```sh
pnpm lens app
```

This runs a local page at `http://127.0.0.1:4317/`. Paste a pull request or merge request link to add it; analyses run one at a time, and the list shows each review's status, security level and counts. Refresh re-runs a review after new commits. The list is kept in SQLite under `~/.local/share/lens`, so it survives restarts. If `GITHUB_TOKEN` is not set, the app asks the GitHub CLI for its login on that PR's host.

The server listens only on your machine, refuses requests for any other host name, and its API needs a key that is created each run.

## Private repositories

Private repositories and merge requests work once a token is in the environment. It is used for both the host's API and fetching the code, and it stays out of the command line and the cached repository's config.

**GitLab**: create a personal or project access token with the `read_api` and `read_repository` scopes (`api` if you will also post comments with `lens comment`):

```sh
GITLAB_TOKEN=<token> pnpm lens review https://gitlab.com/group/project/-/merge_requests/123
```

**GitHub**: use a token that can read the repository. With the GitHub CLI:

```sh
GH_TOKEN=$(gh auth token) pnpm lens review https://github.com/owner/repo/pull/123
```

`GITHUB_TOKEN` works too. Self-managed GitLab and GitHub Enterprise are recognized from the URL and use the same variables, once listed in `LENS_TRUSTED_GITLAB_HOSTS` or `LENS_TRUSTED_GITHUB_HOSTS`. Without a token, a private repository usually answers 404, and lens says which variable to set.

Tokens and code stay on your machine, apart from the host itself, package names and versions sent to [OSV](https://osv.dev) (`--offline` skips that), and the code sent to the model if you pass `--ai`.

## In CI

The GitHub Action (`navasvarela/reviewlens@main`) and the GitLab template (`ci/gitlab-ci.yml`) generate the report for each PR, keep it as a job artifact, and post one summary comment that is updated on each push. The [pilot guide](docs/pilot.md) has the setup. Locally, `lens review` also works without a URL inside a CI job, and `lens comment --report <dir> --report-url <url>` posts the summary.

## AI review

`--ai` sends the changed code, the PR title and description to Claude (`claude-opus-5-5` by default;
`--ai-model` to change it) through the official Anthropic SDK. Credentials come from `ANTHROPIC_API_KEY`
or an `ant auth login` profile. `--ai-max-input-tokens` (default 40,000, about $0.16 of input) caps the
prompt; past it, units are sent by name only and the report says how many. Without `--ai`, nothing is
sent. A repository can forbid AI review entirely with `"ai": { "allowed": false }` in `.lens.json`.

## Security scanners

Lens runs [Semgrep](https://semgrep.dev), [gitleaks](https://github.com/gitleaks/gitleaks) and
[osv-scanner](https://github.com/google/osv-scanner) when they are installed. All three are optional:
the Risks tab lists each one under "Checks that ran" or under "Not checked", with how to install it.

```bash
brew install semgrep gitleaks osv-scanner
```

| Scanner | Finds | Network |
| --- | --- | --- |
| Semgrep | Risky code patterns, using the `p/default` rules | Downloads rules; your code is not uploaded |
| gitleaks | Secrets | None |
| osv-scanner | Known vulnerabilities in `pnpm-lock.yaml`, `yarn.lock` and `bun.lock` | Sends package names and versions to OSV |

Only findings on lines the PR added are reported, and `--offline` skips Semgrep and osv-scanner.
Scanners read a temporary copy of the changed files, without your tokens in their environment. A PR
cannot silence them: `# nosemgrep` and `gitleaks:allow` comments are ignored, and scanner config files
in the PR (`.gitleaks.toml`, `.semgrepignore` and others) are not used. Those files are not scanned either.

Choose Semgrep's rules in `.lens.json`; an empty list turns Semgrep off:

```json
{ "scanners": { "semgrep": { "rules": ["p/default", "p/owasp-top-ten"] } } }
```

CI runners need the scanners installed in the job before running Lens.

## Team rules

A `.lens.json` at the repository root adds sensitive areas, excludes paths from risk rules, and can
forbid AI review. A PR is always judged by the version on its merge base, so its own edits to the file
take effect only after merge, and are reported as a finding:

```json
{
  "riskPaths": [{ "pattern": "src/ledger/**", "severity": "high", "reason": "Moves customer funds" }],
  "ignore": ["tests/fixtures/**"],
  "ai": { "allowed": true },
  "feedback": { "url": "https://forms.example.com/reviewlens" }
}
```

## How it works

1. **Providers** (`packages/providers`) parse the URL and read the PR from the host's API, including its merge base.
2. **Engine** (`packages/engine`) fetches only the merge-base and head commits (depth 1) into a cached bare
   repository under `~/.cache/lens/repos`, builds the file list and hunks from `git diff`, classifies noise,
   and parses both versions of each file with tree-sitter (WASM) to extract and compare units
   (`src/syntax`: one small spec per language, a shared walker, token fingerprints for comparison).
   `src/impact` then scans the head commit's source for the changed names and parses the matching files
   to resolve references, `src/risk` runs the risk rules and dependency checks, and `src/ai` builds the
   prompt, calls the model and validates its citations. Git commands whose
   output is parsed run without user and system git config, which can otherwise change the output format.
3. The **review model** (`packages/review-model`) is the JSON contract between the engine and every
   consumer, validated with Zod on both sides.
4. The **CLI** (`packages/cli`) writes the report as one self-contained HTML file, plus `review.json` as
   data, and serves it on `127.0.0.1`. The page also opens directly from disk, which is how CI artifacts
   are used.
5. The **report UI** (`packages/report-ui`) is a React app built with Vite.

## Development

```sh
pnpm typecheck
pnpm test
pnpm --filter @lens/report-ui dev   # needs a review.json in packages/report-ui/public
```

## License

[FSL-1.1-ALv2](LICENSE.md), the Functional Source License. You can use, modify and redistribute this software for any purpose except offering it as a competing commercial product or service, and internal use is explicitly allowed. Each version becomes available under the Apache License 2.0 two years after its release. This is source-available, not an OSI-approved open source license.
