Publish a new version of @blueshed/railroad.

Argument: version bump type — "patch", "minor", or "major". Default: "patch".

Steps:

1. Run `bun test --coverage` and `bun check`. Stop if either fails.
2. Read the current version from `package.json`.
3. Bump the version according to the argument (patch/minor/major).
4. Write a changelog entry in `CHANGELOG.md` following the existing format. Summarise changes since the last version using `git log`.
5. Update the version in `package.json`.
6. Commit with message `v{version} — short description`.
7. Tag with `git tag v{version}`.
8. Ask the user for confirmation before pushing.
9. Push commit and tags.
10. Create a GitHub release via `gh release create v{version}` with notes from the changelog.
11. Report the release URL. CI handles npm publish.

Rules:
- Never use `npm` or `npx`. This is a Bun project.
- Never run `npm publish` locally. CI does it via `.github/workflows/publish.yml`.
- Always run tests and type check before bumping.
