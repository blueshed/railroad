// A mixed app: React's types (@types/react up to 18) declare a global JSX
// namespace like this one. Railroad declares none, so the two don't clash
// (railroad's old global `type Element = Node` beside this `interface Element`
// was TS2300 Duplicate identifier), and railroad JSX still types from its own
// namespace: app.tsx's `const node: Node = <div />` would fail against this
// Element, which is not a Node.
declare global {
  namespace JSX {
    interface Element {
      type: unknown;
      props: unknown;
      key: string | null;
    }
    interface ElementClass {
      render(): unknown;
    }
    interface IntrinsicElements {
      div: { className?: string };
    }
  }
}

export {};
