# Contributing

Start with the [README demo](README.md#quick-start) using Node 24+ and pnpm 10. Use a disposable blog checkout and database: first-run import moves drafts into SQLite, deletes their Markdown files, and attempts a backup commit and push. Never test against a running writer's data.

Pick an [open issue](https://github.com/mrgnw/cfcms/issues), or start with a [good first issue](https://github.com/mrgnw/cfcms/labels/good%20first%20issue). Bug reports should include reproduction steps, expected and actual results, and browser and Node versions. Remove private post text and credentials from logs and screenshots.

Keep changes focused on the single-writer workflow in [ROADMAP.md](ROADMAP.md). Discuss larger features in an issue first. Use tabs for indentation. Add a regression check for behavior changes alongside the existing `src/**/*.check.ts` files.

Run both checks from your development checkout before opening a pull request:

```sh
pnpm build
pnpm test
```

Describe the problem, the resulting behavior, and how you verified it. Link the issue and include screenshots for visible changes, using sample posts only. Disclose substantial AI assistance and verify generated changes yourself.

Contributions to cfcms are covered by its [MIT license](LICENSE). Dependencies retain their own licenses; see the [README license notes](README.md#license).
