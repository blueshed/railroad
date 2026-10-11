// A page as it is served unbundled: tests/webview.test.ts builds this with process.env.NODE_ENV left
// as written, and a browser has no `process`, so railroad must take it for development and warn
// about the .get() in View's render body.
import { createElement, signal, mount } from "../../index";

const s = signal("read once");

function View() {
  return <p data-testid="read">{s.get()}</p>;
}

mount(document.body, () => <View />);
