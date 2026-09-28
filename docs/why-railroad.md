# Why we wrote Railroad

*Bun 1.3 ships the entire build pipeline. The only thing missing was a reactive layer small enough to trust.*

## The stack tax

We build realtime apps — boards, dashboards, collaborative editors, the kind of thing where a change on one screen lands on every other screen a few milliseconds later. For years the cost of *starting* one of those was depressingly fixed. Before you wrote a line of your own code, you assembled a stack: a bundler, a dev server, a framework, a plugin to teach the bundler about the framework, a config file for each. Then you'd lose an afternoon getting hot reload to actually reload, and another getting the production build to behave like the dev build.

None of that is your application. It's tax.

We paid it for years because the alternative — wiring up transpilation, bundling, hashing, and HMR by hand — was worse. The framework and its build toolchain came as a bundle, and you took the whole bundle.

Then Bun 1.3 changed the bill.

## What Bun already gives you

The thing that's easy to miss about Bun is that it quietly absorbed the parts of the frontend stack that normally need three packages and a config file to assemble. Not as add-ons — as runtime features:

- **HTML imports in `Bun.serve`.** The server reads `import index from "./index.html"`, walks the `<script>` and `<link>` tags, transpiles your TSX, bundles the imports, processes the CSS, and content-hashes the asset URLs. No `vite.config.ts`. No build step in development.
- **First-class JSX/TSX**, with `jsxImportSource` honoured by both the transpiler and the bundler.
- **HMR** modelled on Vite's `import.meta.hot`, including console mirroring.
- **`bun build --compile`** — the entire HTML + TSX + server graph compiled into a single static binary you can `scp` to a box. No Node, no install, no Docker layer.
- **`Bun.WebView`** — a real headless browser you can drive from the same `bun test` you already run for unit tests.

Look at that list and the realization arrives on its own: Bun ships the build pipeline. The dev server, the bundler, the transpiler, the asset hashing, the HMR, even the browser-test harness — all of it, in the runtime, with zero config.

So what's actually left? One thing. A way to bind state to the DOM and have the DOM update when the state changes. Reactivity. That's the whole gap.

## The one missing piece — and why nothing fit it

The obvious move is to drop React in. But React doesn't *fit the slot*; it fills a different one. It brings a virtual DOM, a reconciler, a hooks model, and tens of kilobytes — a whole runtime that assumes it owns rendering. Bolting it onto a runtime that already bundles and hot-reloads is putting an engine inside an engine. Solid is closer in spirit but leans on a compile step — and we'd just spent the whole section celebrating that Bun made the compile step disappear. Lit means committing to web components. Each is a fine framework; none is a thin reactive layer that sits on top of Bun's pipeline and gets out of the way.

Two libraries come much closer — and, as it happens, I'd already written about both.

## "But VanJS and ArrowJS already exist"

This is the fair question, and the one I kept asking myself, because I've written about both [ArrowJS](https://www.arrow-js.com) and [VanJS](https://vanjs.org) and I rate them. They're exactly the right *species*: real DOM, fine-grained reactivity, no virtual DOM, no reconciler, measured in kilobytes. Line railroad up next to them and a stranger couldn't tell which one I wrote.

So why not just use one? It comes down to a single bet about the build step.

VanJS and ArrowJS are both designed to *avoid* the build step — that's their headline value: drop a `<script>` tag and ship, no tooling, no compiler, no config. And because JSX needs a transpiler, both route around it. VanJS composes the DOM with tag functions — `div(button({onclick}, count))`. ArrowJS uses tagged template literals — `` html`<button>${count}</button>` ``. Both are clean, both deliberate, both built *specifically so you never have to set up a compiler.*

Railroad makes the opposite bet, because Bun changed what that bet costs. JSX's historical price was a toolchain — but Bun transpiles TSX with zero configuration, and `jsxImportSource: "@blueshed/railroad"` in `tsconfig.json` is the entire setup, working unchanged through HMR, the production bundler, and `--compile`. The build step those two libraries were designed to spare you is already running, for free, whether you use JSX or not. Once the compiler is a sunk cost, avoiding JSX stops buying you anything — and JSX buys back a lot: real TSX with full type-checking on your markup, the editor tooling everyone already has, and a component model the next developer (or the model in their editor) recognizes on sight.

So it isn't "mine is better." It's a different bet. VanJS and ArrowJS optimize for *no tooling at all* — and if that's your constraint, they're excellent and you should reach for them. Railroad optimizes for *Bun's tooling, which is already there* — and in exchange it leans all the way into JSX/TSX instead of around it.

There's a subtler form of the same question, and Vue is its sharpest version — because on paper Vue has *everything* the slot seems to want: signals (`ref` is the same family), a JSX runtime, even a `jsxImportSource: "vue"` you can name in `tsconfig.json`. So why not point Bun straight at Vue? Two things stop it. Vue's real JSX transform — `v-model`, directives, slot and patch-flag optimizations — lives in a *Babel* plugin, and Bun runs its own native transpiler, not Babel; `jsxImportSource: "vue"` mainly buys you JSX *types*, not a Babel-free transform, so getting the good version back means reintroducing exactly the tooling Bun let you delete. And more fundamentally, Vue's JSX compiles to *vnodes*, not DOM — render functions that do nothing until Vue's runtime mounts them, diffs them, and re-runs them on every change. Point Bun at Vue and you've imported the whole virtual-DOM engine, the weight railroad exists to skip. Which exposes the requirement hiding inside the "just point `jsxImportSource` at it" pitch: **the slot only works if the JSX runtime returns real DOM.** Signals plus a JSX runtime isn't the bar — Vue has both. Returning DOM, once, is.

The two further reasons are what the rest of this piece is about. Railroad isn't only a view layer; it's the small *set* the Bun fullstack shape actually needs — signals, JSX, a hash router with reactive params, typed DI, a leveled logger — each independently importable, all tuned to sit in the same `Bun.serve` that's hosting your HTML and your WebSocket. And it carries the realtime escape hatches — `.touch()`, `.mutate()`, a keyed `list()` — that are the actual reason it exists. Those are opinions a general-purpose one-kilobyte renderer rightly doesn't take.

So we wrote railroad: the slot Bun leaves open — signals, a real-DOM JSX runtime, and a hash router, and nothing Bun already does itself. No bundler, no compiler, no SSR layer Bun doesn't have anyway. You get reactivity; you keep Bun's pipeline.

## The bet: real DOM and signals

The core design decision is the one that keeps the whole thing small: **components run once.**

A railroad component is a function that runs a single time and returns a real DOM node. That's it — there's no re-render, no reconciliation, no diffing, no virtual tree to keep in sync with the real one. So where does the "reactive" come from? From signals. Reactivity lives in the *values*, not in re-running the view:

```tsx
const name = signal("World");
function Greeting() {
  return <h1>Hello {name}</h1>;   // the bare signal binds to a reactive text node
}
```

When you put a bare signal in the JSX, the runtime wires it to a text node that updates when the signal changes. A signal as a prop becomes a reactive attribute. A function child auto-tracks whatever signals it reads. The component never runs again — only the specific text nodes and attributes that depend on a changed signal do any work.

This is the same family as Vue's `ref`, Solid's `createSignal`, and Preact's signals: push-based, fine-grained. It is deliberately *not* a TC39 Signals implementation or anything clever enough to need a paper. The entire library is around a thousand lines and has zero runtime dependencies. Every module — signals, jsx, routes, the DI container, the logger — is independent and importable on its own, so you can take just the signals into a CLI or a worker and never touch the JSX.

## The reason it actually exists: realtime

All of that is the *shape* of the library. The *reason* for it is realtime.

When your state is a large document being mutated in place by a patch stream — a CRDT update, a custom WebSocket protocol, a Postgres `LISTEN/NOTIFY` payload — the naive reactive pattern falls apart. You don't want to clone a thousand-row document on every keystroke just to convince your framework something changed. So railroad has escape hatches built for exactly this:

```tsx
ws.onmessage = (ev) => {
  applyPatch(rows.peek(), JSON.parse(ev.data));  // mutate the existing array
  rows.touch();                                   // notify, without cloning
};
```

`.touch()` fires subscribers without replacing the reference. `.mutate()` gives you the safer `structuredClone`-then-mutate middle ground. `.patch()` shallow-merges object signals. And `list()` — a keyed reactive list — does surgical per-row DOM updates, so a patch that touches one row touches one row's nodes, not the whole list.

This is also why railroad has a sibling, [`@blueshed/delta`](https://www.npmjs.com/package/@blueshed/delta): a turnkey WebSocket sync layer whose document's `data` field *is* a railroad signal, not a wrapper around one. It drops straight into `list()` and `when()` with no glue. Railroad is the reactive half; delta is the sync half; they were designed to be the same idiom.

## The constraint that shaped everything: legibility

There's one more design driver, and it's the one I'd defend hardest. Railroad is built so that **you can hold all of it in your head** — and so that an LLM can use it correctly without re-reading the documentation every time.

That second part isn't a gimmick. We write a lot of code with AI assistance now, and a framework that an assistant gets subtly wrong — `className` instead of `class`, a `.get()` snuck into JSX where it silently kills reactivity, an effect left to leak at module scope — is a framework that generates a steady drip of plausible-looking bugs. So legibility became a hard requirement, not a nice-to-have. The library ships its own Claude Code skills. Every source file's JSDoc header is the authoritative API reference. The skill isn't a tutorial — it's a checklist of *the failure modes that have actually shown up in development*: the seven things that bite if you're not careful. The whole surface is small and predictable enough that "the obvious thing" is usually the correct thing, for a person or a model.

A framework you can fully understand is a framework you can debug, trust, and own. That's worth more than features.

## The honest arc

Railroad didn't start this focused. The first release was a 400-line "micro UI framework for Bun." Then it grew — it sprouted a document-sync module, then a SQLite backend, then a Postgres one. For a while it was trying to be a full realtime stack in one package.

That was a mistake, and the most important release was the one where we *removed* things: we split the sync machinery out into `@blueshed/delta` and refocused railroad on being the reactive layer and nothing more. Two libraries that each do one thing beat one library that does two things and makes you take both.

The releases since have been about earning trust rather than adding surface. Signals became glitch-free — propagation is now topologically scheduled, so a diamond (`a → b`, `a → c`, an effect reading both) settles in one consistent pass and never observes half-updated state. Dispose scopes got a real API and a guardrail that warns when a `when()` or `list()` is created somewhere it would leak. SVG became first-class, namespace and all, verified in real Chrome through `Bun.WebView`. Most of that came out of deliberate, adversarial correctness reviews, and every fix is pinned by a regression test. The library got *better* without getting bigger.

## What it isn't

Railroad is not an SSR or RSC framework — Bun doesn't ship those, and railroad doesn't bolt them on. It's not a TC39 Signals implementation. It's not a 30KB framework with a hooks system and a virtual DOM. If you want any of those, railroad is the wrong tool, and that's fine.

What it is: the smallest correct reactive layer for the workflow Bun 1.3 actually ships — HTML imports, TSX bundling, HMR, and `--compile` to a single binary. You bring your app; Bun brings the pipeline; railroad is the thin, legible, honest piece in the middle that makes state show up on the screen.

That's the niche. It's a real one.
