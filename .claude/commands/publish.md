---
description: Publish a new version of @blueshed/railroad
argument-hint: "patch | minor | major"
---

# Publish

Publish a new version of `@blueshed/railroad`.

Argument: version bump type — `patch`, `minor`, or `major`. Default: `patch`.

## Steps

1. Run `bun test --coverage` and `bun run check`. Stop if either fails.
2. Read the current version from `package.json`.
3. Bump the version according to the argument (patch/minor/major).
4. Write a changelog entry in `CHANGELOG.md` following the existing format. Summarise changes since the last version using `git log`.
5. Update the version in `package.json` AND in the `version:` frontmatter field of every shipped skill — currently `.claude/skills/railroad/SKILL.md` and `.claude/skills/bun-route/SKILL.md`. They ride along with the package and must stay in lockstep with `package.json`.
6. Commit with message `v{version} — short description`.
7. Tag with `git tag v{version}`.
8. Push commit and tags. (Per global CLAUDE.md, invoking `/publish` is the authorisation — no mid-flight confirmation needed.)
9. Create a GitHub release via `gh release create v{version}` with notes from the changelog section.
10. Report the release URL. CI (`.github/workflows/publish.yml`) handles npm publish.

## Rules

- Never use `npm` or `npx`. This is a Bun project — `bun`, `bunx`, `bun run`.
- Never run `npm publish` locally. CI does it.
- Always run tests and type check before bumping.
- If `package.json` is already at the target version (changelog entry already prepared), skip the bump step and ship the existing version as-is.
