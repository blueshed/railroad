# Skill evaluations

Three scenarios per shipped skill (`railroad.json`, `bun-route.json`), each aimed at a trap
the skill exists to prevent. They are not run by `bun test` and do not ship to npm.

To run one by hand: in a fresh, empty folder, start a new Claude Code session with the
skills in `skills` loaded (copy `.claude/skills/` in), give it the `query` word for word (where
the query describes an existing project, let it create those files first), then check the
code it writes against each line of `expected_behavior`. Every line should hold. Run each
scenario with and without the skill to see what the skill adds.
