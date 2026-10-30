# Running a pilot

The goal is to learn whether reviewers choose to use the report, and whether reviews get faster without letting more bugs through. Run it with 8 to 10 volunteers on real PRs for two weeks, and take baselines from the four weeks before.

## Setup

### GitHub

Add `.github/workflows/reviewlens.yml`:

```yaml
name: ReviewLens
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  report:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: navasvarela/reviewlens@main
        # For AI review:
        # with:
        #   ai: "true"
        #   anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Each PR gets one comment, updated on every push, with the security level, counts, top findings and a link to the report. The link needs a signed-in GitHub account with access to the repository.

A PR from a fork gets a read-only token, so no comment is posted; the same summary appears on the workflow run's summary page.

### GitLab

Include the template in `.gitlab-ci.yml`:

```yaml
include:
  - remote: https://raw.githubusercontent.com/navasvarela/reviewlens/main/ci/gitlab-ci.yml
```

Set `GITLAB_TOKEN` as a masked CI/CD variable: a project access token with the `api` scope. The job needs merge request pipelines. The report link opens in the browser on instances with GitLab Pages enabled; otherwise it downloads as a single HTML file that opens from disk.

### Feedback link

Create a short form in a tool your team already uses, and add its address to `.lens.json` on the default branch. It then appears in the comment and the report:

```json
{ "feedback": { "url": "https://forms.example.com/reviewlens" } }
```

Use your own form rather than this project's public issue tracker, since feedback may describe private code.

## What to measure

| Metric | How | Target (proposal) |
| --- | --- | --- |
| Voluntary use | Ask in the weekly form; 👍/👎 reactions on the comment show engagement | Over 60% of pilot reviews by week 2 |
| Time to first review | PR opened to first review, from the host's API | 20% below baseline |
| Time spent on large AI-written PRs | Self-reported per review | 30% below baseline |
| Escaped defects | Bugs traced to pilot PRs within 30 days | No increase |
| Usefulness by section | Weekly form | Over 70% positive, or cut the section |
| Wrong AI statements | Reviewers report them in the form | Under 10% of statements |

Split every metric by AI-generated and hand-written PRs. These are measured by hand or with your own scripts: the tool does not collect any usage data.

## Questions for the weekly form

1. How many reviews did you do this week, and in how many did you open the report?
2. Which sections helped: changed units, collapsed noise, used-by lists, risk findings, reading order, description check, questions?
3. Which section was wrong or got in the way? Give an example.
4. Did the report change a review decision, or catch something you would have missed?
5. Did you see a false alarm? Which finding, on which PR?
6. If you stopped opening the report, why?

## Before you start

- Try it on a few merged PRs and check that nothing surprising appears in the comment. Comments are visible to everyone who can see the PR.
- Decide on AI review per repository. It sends changed code, plus the PR's title and description, to Anthropic. `"ai": { "allowed": false }` in `.lens.json` forbids it, whatever the job is configured to do.
- `.lens.json` rules apply once merged: a PR is always judged by the rules on its merge base, and a change to the file is itself a finding.
- The checks that did not run are listed in every report. Tell volunteers that a low security level is not an approval.
