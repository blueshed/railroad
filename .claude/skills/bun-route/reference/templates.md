# Route files by mode

`about/about.html`, the entry Bun bundles (the script's extension is the mode's: `.js`, `.ts` or `.tsx`):

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About</title>
    <link rel="stylesheet" href="./about.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./about.tsx"></script>
  </body>
</html>
```

`about/about.tsx` in **tsx-railroad** mode (the `railroad` skill has the API and what bites; read it before writing components):

```tsx
import { mount } from "@blueshed/railroad";

function Page() {
  return (
    <div>
      <h1>About</h1>
      <p>Content here</p>
    </div>
  );
}

mount(document.getElementById("root")!, () => <Page />);
```

- `mount()` opens the page's dispose scope. A bare `.append(<Page />)` works but leaves top-level `when()`/`list()` undisposable (railroad warns). For an interactive page prefer `routes(root, { "/": () => <Page /> })`: navigation, params and scopes come with it.
- **js / ts** mode, plain DOM:

  ```ts
  const el = document.createElement("div");
  el.innerHTML = `<h1>About</h1><p>Content here</p>`;
  document.getElementById("root")!.append(el);
  ```

- **tsx-react** mode: `import { createRoot } from "react-dom/client";` then `createRoot(document.getElementById("root")!).render(<Page />);`.
- Paths in the HTML are relative (`./`) to the HTML file; scripts are `type="module"`. Bun bundles `.js`, `.ts`, `.tsx` and `.jsx`, resolves CSS `@import`, and content-hashes the assets: no asset pipeline.
- Each route's CSS is self-contained: resets, layout and typography in the file itself, no shared `base.css`. Match the existing routes' style.
