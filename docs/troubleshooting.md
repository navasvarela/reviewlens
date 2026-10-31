# Troubleshooting

Find the message you see, or the symptom below. If nothing here helps, [open an issue](https://github.com/navasvarela/reviewlens/issues) with the command you ran and the full error. Leave out tokens and private code.

## Starting Lens

### `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`

You ran `pnpm lens` outside the Lens folder. Change to the folder where you cloned it, then run the command again.

### `Port 4317 is in use`

The app is probably already running, so open `http://127.0.0.1:4317/`. To run another copy, choose a different port:

```bash
pnpm lens app --port 4318
```

### `The report UI has not been built`

This happens if you run `packages/cli/src/main.ts` directly. Use `pnpm lens`, which builds the page first, or run:

```bash
pnpm build:ui
```

### Node.js errors on startup

Lens needs Node.js 22.18 or newer. Check your version:

```bash
node --version
```

On Node.js 22 you may see an `ExperimentalWarning` about SQLite. It's harmless.

## Pull requests and access

### `Not a pull request URL`

Use the link to the pull request or merge request itself:

- `https://github.com/owner/repo/pull/123`
- `https://gitlab.com/group/project/-/merge_requests/45`

### `responded 404` or `responded 401`

For a private repository, this usually means the token is missing or can't read it. GitHub and GitLab both answer 404 for a private repository you can't see, so the link may be fine.

1. Check that the link opens in your browser.
2. Set a token, as shown in [Getting started](getting-started.md#private-repositories).
3. For GitLab, check that the token has the `read_api` and `read_repository` scopes.
4. For a GitHub organization that uses SSO, authorize the token for that organization.

In the app, a token set in the terminal only applies if it was set before `pnpm lens app` started. Restart the app after changing it.

### `responded 403` from GitHub

You have probably hit the API rate limit, which is low without a token. Set `GITHUB_TOKEN` or `GH_TOKEN`. If you already have, check that the token can read the repository.

### `did not provide …; the branch may have been force-pushed`

The commits Lens asked for are no longer on the host. Run the review again so it picks up the latest commits. If it's a review in the app, refresh it.

### `GitLab has not computed the diff … yet`

Wait a moment and try again. This is common just after a merge request is opened.

### `.lens.json is not valid JSON` or `.lens.json is invalid`

The repository's own `.lens.json` has a mistake, and the review stops until it's fixed. Lens reads the file from the PR's merge base, so fixing it in the PR doesn't help. Fix it on the target branch, then run the review again. The settings are listed in [Configuration](configuration.md#team-rules-lensjson).

## The report

### The page is blank or stuck on "Loading review…"

1. Reload the page.
2. Check that the terminal running Lens is still open, because the address stops working when Lens stops.
3. Generate the report again with `pnpm lens`, which also rebuilds the page.
4. If it's still blank, open the browser's developer console and include any error in your issue.

### The Changes tab shows a line diff instead of functions

Lens only understands Rust, TypeScript, JavaScript and Python. Other languages get a line diff, and so do files over 1 MB and files that aren't text.

### A file is collapsed or marked as skippable

Lens groups lockfiles, vendored code and generated files. A file counts as generated if its path suggests it, or if it has a `@generated` or `DO NOT EDIT` header. You can still expand it.

### A function shows as removed and added

Lens shows a function as removed and added when it was both moved and edited in the same PR. Moves without edits are folded away.

### Impact shows a caller that isn't really a caller

Lens finds references by name and syntax, not by resolving types, so another function with the same name can match. Check the confidence label:

- **Exact:** qualified with the type, such as `Size::new`.
- **Likely:** a direct use of the name.
- **Possible:** `x.method()` where the type of `x` is unknown. These are the most likely to be wrong.

### Impact says a name is too common to trace

Names found in more than 200 files, such as `new` or `get`, aren't traced. Very large PRs may also trace only some of their changes, and the report says so.

### The security level is low, but I expected findings

Check "Not checked" on the Risks tab first. Also note that:

- Scanners only report problems on lines the PR added, so older problems don't appear.
- Paths under `ignore` in `.lens.json` aren't checked.
- Lockfiles and vendored code aren't checked by the secret and code rules.

A low level never means the change is safe.

## Security scanners

### A scanner is listed under "Not checked" as not installed

Install it and start Lens again:

```bash
brew install semgrep gitleaks osv-scanner
```

If it's installed but still not found, Lens can't see it on your `PATH`. Check from the terminal that starts Lens:

```bash
which semgrep gitleaks osv-scanner
```

When you start `pnpm lens app`, its log lists the scanners it found.

### A scanner is listed as failed

The reason shown is the first line of the scanner's error. The usual causes are:

- **Semgrep can't download rules:** check your network or proxy. You can use `--offline` to skip it.
- **A rule pack doesn't exist:** check `scanners.semgrep.rules` in `.lens.json`.
- **A very large PR:** each scanner stops after 5 minutes.

### `# nosemgrep` or `gitleaks:allow` doesn't hide a finding

This is on purpose, so that a PR can't hide its own findings. Scanner config files in a PR, such as `.gitleaks.toml`, aren't used either.

### A false alarm on one path

Add the path to `ignore` in `.lens.json` on the target branch. This removes it from all risk checks, not only the one that raised the alarm.

### The same line has two findings

A built-in rule and Semgrep can both flag one line, as with `shell=True`. Lens keeps both, in case they're about different problems. Repeated secrets on a line are merged into one.

## AI review

### `Anthropic rejected the credentials`

Set `ANTHROPIC_API_KEY`, or run `ant auth login`.

### `.lens.json forbids sending this repository's code to a model`

Either version of `.lens.json` (the merge base or the PR) has `"ai": { "allowed": false }`. Someone with access to the target branch has to change it.

### `rate limited by the Anthropic API`

Wait a little and run it again.

### The AI review says some units were sent by name only

The PR went over the prompt budget. Raise it with `--ai-max-input-tokens`, which also raises the cost. The report shows the tokens used and the estimated cost.

### `the model declined to review this change` or `the response exceeded … and was cut off`

The rest of the report is unaffected. Try again, or review this PR without AI. For a response that was cut off, a smaller PR usually helps.

## The app

### A review says `The app stopped during this analysis`

The app was closed while the review was running. Refresh that review to run it again.

### A review stays on "Queued"

Analyses run one at a time, so it's waiting for the one before it. A large repository's first analysis can take several minutes.

### The app's API refuses a request

The app only answers on `127.0.0.1` and `localhost`, and its API needs a key created each time it starts. After restarting the app, reload the page. Opening it through another host name or a proxy won't work.

## CI

### No comment appears on the pull request

- **PR from a fork:** GitHub gives these a read-only token, so no comment is posted. The summary is on the workflow run's page instead.
- **Missing permission:** the GitHub workflow needs `pull-requests: write`.
- **GitLab:** `GITLAB_TOKEN` must be a masked CI/CD variable with the `api` scope, and the job needs merge request pipelines.

### `This workflow run is not for a pull request`

Trigger the workflow with `on: pull_request`.

### `This pipeline is not for a merge request`

Run the job on `merge_request_event`.

### The report link in the comment doesn't open

On GitHub, the link needs someone signed in with access to the repository. Artifacts also expire, 14 days after the run by default. Push a new commit or re-run the job to create a new one.

### Scanners are listed as not installed in CI

CI runners don't have them by default. Install them in the job before Lens runs.

## Starting fresh

If a cached repository seems wrong, delete the cache. It's rebuilt on the next run:

```bash
rm -rf ~/.cache/lens
```

Existing reports in the app stop opening until you refresh them. To also empty the app's review list, stop the app and delete `~/.local/share/lens/lens.db`.
