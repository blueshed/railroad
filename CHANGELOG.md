# Changelog

## 0.1.1

### Fixed

- **`when()` now only swaps on truthiness transitions.** Previously, any value change (e.g. `"a"` → `"b"`) would destroy and recreate the truthy branch. Now it compares `!!oldVal` vs `!!newVal` and only swaps when the branch actually changes (falsy↔truthy). Components inside each branch should use signals to react to value changes within the same branch.

## 0.1.0

### Added

- **Signals** — `signal`, `computed`, `effect`, `batch` with automatic dependency tracking and cleanup.
- **JSX runtime** — `createElement`, `Fragment` producing real DOM nodes. Signal-aware children and props auto-update via effects.
- **Reactive helpers** — `text()` for computed text nodes, `when()` for conditional rendering, `list()` for keyed list rendering.
- **Dispose scoping** — `pushDisposeScope` / `popDisposeScope` to collect and clean up effects.
- **Routes** — hash-based client router with automatic dispose scoping on navigation.
- **Shared** — typed dependency injection via `key`, `provide`, `inject`.
