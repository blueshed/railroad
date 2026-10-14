# One copy of railroad per page

```sh
# The app links a delta checkout, which brings its own node_modules/@blueshed/railroad.
# Install a packed tarball instead: it has no node_modules, so delta's peer is the app's railroad.
cd ../delta && bun pm pack               # writes blueshed-delta-<version>.tgz
cd ../app   && bun remove @blueshed/delta && bun add ../delta/blueshed-delta-<version>.tgz
```

Each copy has its own `Signal` class, scopes and provider registry, and railroad does not bridge them.

- Symptoms: the UI stops updating, an effect reading delta's `doc.data` never re-runs, `inject(WS)` finds no provider, `openDoc()` in a component never auto-closes.
- In development a second copy logs `A second copy of @blueshed/railroad has loaded (…)`, naming both. In any build, a Signal from the other copy throws where JSX, `when()` or `list()` is given it.
- The usual cause is a `file:` link or `bun link` to a checkout.
- Repeat both commands after each change to the checkout. Re-adding the same tarball keeps the old contents, as do `bun install --force` and deleting `node_modules/@blueshed/delta`, because `bun.lock` pins the first tarball's hash; deleting `bun.lock` also works.
