# Futures

Things discussed, designed, or partially explored but not yet built.

## Conflict resolution

Currently last-write-wins. If two clients send ops for the same field simultaneously, the last one to arrive at the server takes effect.

Delta-doc is server-authoritative by design. Full CRDTs (Yjs ~27 kB, Automerge ~150–300 kB) would add significant weight and contradict railroad's zero-deps philosophy. Instead, conflict awareness is planned in three incremental levels:

### Level 1 — Version stamping + conflict notification (next)

- Server tracks a monotonic `version` per doc and keeps a bounded op log (last 100 ops)
- Client sends `baseVersion` with each delta
- Server always applies ops (last-write-wins behaviour is unchanged), but when `baseVersion` is stale and intervening ops overlap the same JSON Pointer paths, the response includes a `conflicts` array
- Client surfaces conflicts via a `conflicts` signal on the `Doc` — the app decides what to do (toast, undo, ignore)
- Broadcasts include version so all clients track document state

```ts
// client — reactive conflict awareness
const doc = openDoc<T>("project:abc");

effect(() => {
  const c = doc.conflicts.get();
  if (c) showToast(`Conflict on ${c.map(x => x.path).join(", ")}`);
});

// send returns conflicts too
const result = await doc.send(ops);
if (result.conflicts) { /* handle */ }
```

### Level 2 — Path-aware auto-merge (future)

When stale ops arrive, the server transforms incoming ops against intervening ops before applying:

- **Different paths** → no conflict, apply as-is (most common case — two users editing different fields)
- **Same leaf path** → last-write-wins (still notifies via Level 1)
- **Array index shift** → adjust indices for intervening add/remove ops
- **Path under removed parent** → drop the op (target no longer exists)

This eliminates false-positive conflict notifications when concurrent edits don't actually interfere.

### Level 3 — Custom merge strategies (future)

Per-field or per-table merge functions pluggable via the schema:

- Counters that add rather than overwrite
- Sets that union
- Timestamps that take the latest
- Application-specific merge logic

### Why not CRDTs?

Yjs (14M npm downloads/month) and Automerge are the right tools for true multi-writer concurrent editing — collaborative text editors, Figma-like multiplayer canvases. Delta-doc targets a different niche: **server-authoritative apps** where a single source of truth is correct. Dashboards, admin panels, config tools, planning apps, chat, IoT displays. For these use cases, version-aware last-write-wins with conflict notification is simpler, lighter, and sufficient.

## Computed/derived fields

Some doc fields are derived from others (e.g. total cost = sum of activity costs for selected travellers). Currently computed client-side. A schema-level `computed` field definition could:

- Calculate on load
- Recalculate and broadcast when dependencies change
- Avoid duplicating business logic across clients

## Pagination / partial loading

For docs with large collections, loading everything on open is expensive. A `limit`/`offset` or cursor-based approach for initial load, with full delta sync for changes, would help. Requires rethinking the doc contract (partial doc vs. full doc).

## WebSocket authentication

`createWs` accepts a `clientId` but has no authentication or authorization layer. Options:

- Token-based auth on upgrade (query param or header)
- Per-doc access control (who can open/delta/close which docs)
- Read-only subscriptions (receive deltas but can't send ops)
