# tsconfig.json by mode

**tsx-railroad**:

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "types": ["bun"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "esnext",
    "strict": true,
    "jsx": "react-jsx",
    "jsxImportSource": "@blueshed/railroad"
  }
}
```

- **tsx-react**: the same block with `"jsxImportSource": "react"`.
- **ts** (no JSX): the same block without `jsx` and `jsxImportSource`.
- **js**: no tsconfig.
- Replace `compilerOptions` whole with the mode's block; don't merge two snippets.
- Keep `"types": ["bun"]`: since TypeScript 6 no `@types` package is included unless `types` names it, and without it `Bun`, `bun:test` and `.html` imports don't resolve. It needs `@types/bun` (`bun init` adds it; else `bun add -d @types/bun`). Never add `bun-types` beside it: the two clash.
