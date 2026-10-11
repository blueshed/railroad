import { signal, mount } from "@blueshed/railroad";

const count = signal(0);

function Counter() {
  return (
    <button onclick={() => count.update((n) => n + 1)}>
      Clicked {count} times
    </button>
  );
}

mount(document.getElementById("root")!, () => <Counter />);
