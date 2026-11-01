# Testing the guided review

A 20-minute test with one engineer at a time, for 3 to 5 engineers. Testing finds out whether the guided review helps, not whether the person is good at reviewing.

## Set up

Generate reports for real PRs the person hasn't seen, from this branch:

```bash
pnpm walkdiff review https://github.com/sharkdp/fd/pull/2191
pnpm walkdiff review https://github.com/pallets/click/pull/3877
```

A PR from your own codebase is better still, as people can judge whether the ranking is right. Don't explain Walkdiff first, and don't help. Ask them to think aloud.

## Tasks

| # | Say this | Watch for | Target |
| --- | --- | --- | --- |
| 1 | Open the report. After 30 seconds, tell me what this PR does, what worries you, and where you'd start. | Whether they can answer from the brief alone | 4 out of 5 |
| 2 | Start reviewing it however you like. | Whether their first click is "Start review" | 4 out of 5 |
| 3 | At the first change: why does Walkdiff show you this one first? | Whether they understand it, and whether they agree | 4 out of 5 |
| 4 | Find everything that calls this function. | Clicks needed | Under 2 clicks, for everyone |
| 5 | Find out whether this function has tests. | Whether they read "a hint" correctly | Everyone |
| 6 | Keep going for 5 minutes. Tell me if you get lost or want something that isn't there. | Where they stop or look elsewhere | Note every case |
| 7 | How would you know you were finished? What didn't Walkdiff check? | Whether they find the finish screen | Everyone |
| 8 | Show me every file this PR changed. | Whether they find "All changes" | Everyone |

## Questions to finish

1. What was the most useful thing? What got in the way?
2. Was anything on the path that shouldn't be there? Was anything missing?
3. Did the order feel right? Where was it wrong?
4. Is there a word you didn't understand?
5. Would you use this instead of the normal diff? Why or why not?

## Record

For each person, record each target as met or not, every place they got lost, and every ranking they disagreed with, with the PR and function. Wrong rankings are the most valuable result, because they can be turned directly into test cases.

## What would change the plan

- **Tasks 1 or 2 fail:** the brief isn't working, so fix it before building more.
- **Task 3 fails:** the reasons or the ranking need work.
- **People leave the path to do their own review:** the path may be too restrictive, and the full list may need to be the starting point instead.
