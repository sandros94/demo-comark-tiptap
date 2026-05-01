# @comark/tiptap

A Comark-aware Tiptap kit. Built on top of `@tiptap/starter-kit`, `@tiptap/extension-image`, and `@tiptap/extension-table` — the schema is whatever Tiptap upstream ships, plus a thin layer that round-trips losslessly to the Comark AST and markdown.

## What's in the box

- **`ComarkKit`** — a single `Extension.create` that registers StarterKit + tables + image + comark-specific nodes (`ComarkComment`, `ComarkTemplate`) + the global `htmlAttrs` declaration + the serializer. Configure / disable any piece via options.
- **`ComarkSerializer`** — owns the dispatch table. `editor.storage.comark.getAst()` / `getMarkdown()`, plus `setComarkAst` / `setComarkMarkdown` commands and string-as-markdown overrides for `setContent` / `insertContent` / `insertContentAt`.
- **`ComarkAttrs`** — adds `htmlAttrs` (a free-form attribute bag) to every stock node and mark via `addGlobalAttributes`. `class` / `id` / `data-*` / `aria-*` / custom — all preserved across the round-trip without touching the per-extension schema.
- **`defineComarkComponent`** — block / inline component factory with typed props and an optional framework-specific `nodeView` slot. Framework wrappers (e.g. `@comark/tiptap-vue`) pick this up to install the framework-rendered NodeView.

## Quick look

```ts
import { Editor } from '@tiptap/core'
import { ComarkKit, defineComarkComponent } from '@comark/tiptap'

const Alert = defineComarkComponent({
  name: 'alert',
  kind: 'block',
  props: {
    type: { type: 'string', default: 'info' },
    title: { type: 'string' },
  },
})

const editor = new Editor({
  extensions: [ComarkKit.configure({ components: [Alert] })],
  content: '# Hello\n\n::alert\nHi\n::',
})

editor.storage.comark.getAst() // ComarkTree (sync)
await editor.storage.comark.getMarkdown() // string (async — comark/render)
editor.commands.setComarkMarkdown('# Hi') // round-trips through comark.parse
editor.commands.setComarkAst(tree) // round-trips through the serializer's dispatch table
```

Three input shapes are honored throughout:

- `string` — markdown, parsed via `comark.parse` (async)
- `ComarkTree` — applied via `setComarkAst`
- `JSONContent` (PM JSON) — applied via Tiptap's stock `setContent`

…and the same three are observable on the way out via the `getAst` / `getMarkdown` / `getJSON` trio.

`editor.getHTML()` is also available — it's pure pass-through to Tiptap's stock method, useful for clipboard / copy-out flows. NOTE: components that ship a framework-rendered NodeView (e.g. `defineComarkVueComponent({ nodeView })`) emit only the generic `<div data-comark-component="…">` marker on this path — for lossless export prefer `getMarkdown()` or `getAst()`.

## Strings are markdown

`@comark/tiptap` is opinionated: **strings are markdown — never HTML**. `ComarkSerializer` overrides `setContent`, `insertContent`, and `insertContentAt` so a string argument always flows through `comark.parse`. Pre-parsed content (PM JSON, `Fragment`, `ProseMirrorNode`) passes through untouched, so callers that already hold structured content keep Tiptap's synchronous behavior. The empty string falls through too, which preserves `clearContent()`'s sync semantics.

```ts
new Editor({ extensions: [ComarkKit], content: '# Hi' }) // markdown
editor.commands.setContent('## Section\n\n- a\n- b') // markdown
editor.commands.insertContent('**bold**', { inline: true }) // inline run
editor.commands.insertContentAt(pos, '## new section') // block insert
```

If you have an HTML string and want it to flow through Tiptap's stock pipeline, pass `{ contentType: 'html' }` — the markdown parse is skipped and the call runs synchronously:

```ts
new Editor({ extensions: [ComarkKit], content: '<h1>Hi</h1>', contentType: 'html' })
editor.commands.setContent('<p>html</p>', { contentType: 'html' })
editor.commands.insertContent('<em>i</em>', { contentType: 'html', inline: true })
editor.commands.insertContentAt(pos, '<h2>Section</h2>', { contentType: 'html' })
```

For JSON-stringified content (either flavor), pass `{ contentType: 'json' }`. The serializer `JSON.parse`s it and routes by shape — `{ nodes: [...] }` is a Comark AST and goes through the AST application path; everything else is treated as PM JSON. Both branches are synchronous:

```ts
editor.commands.setContent(JSON.stringify(comarkTree), { contentType: 'json' })
editor.commands.setContent(JSON.stringify(pmDoc), { contentType: 'json' })
```

OBJECT inputs are auto-detected — passing a `ComarkTree` directly works without `contentType`:

```ts
editor.commands.setContent(comarkTree)                       // → setComarkAst path
editor.commands.insertContent(comarkTree)                    // → insert blocks
editor.commands.setContent({ type: 'doc', content: [...] })  // → stock PM JSON path
```

The `'markdown'` value is the explicit form of the default — pass it for self-documentation, or leave `contentType` off entirely for the same behavior. PM JSON, `Fragment`, `ProseMirrorNode`, and the empty string ignore `contentType` and always pass through synchronously.

### `inline: true`

By default, `insertContent('**bold**')` wraps the parsed markdown in a paragraph and inserts that as a block. Pass `{ inline: true }` to flatten the block structure and drop just the inline run at the cursor:

```ts
editor.commands.insertContent('**emphasis** added', { inline: true })
```

Multi-paragraph markdown passed with `inline: true` is bridged with `hardBreak` so source paragraph boundaries survive the flatten — `'a\n\nb'` becomes `a` + `hardBreak` + `b`, not `ab`. Same on `insertContentAt(pos, md, { inline: true })`.

### Async seed — a divergence from upstream

`comark.parse` is asynchronous, so when `setContent` / `insertContent` / `new Editor({ content })` receive a markdown string, the command returns `true` synchronously but the actual content application lands one microtask later. This differs from projects like [`aguingand/tiptap-markdown`](https://github.com/aguingand/tiptap-markdown) and Tiptap's own `@tiptap/markdown` (both ship sync parsers).

Don't read `editor.getJSON()` immediately after a markdown string seed — listen on `editor.on('update', …)` or wait one tick first. Object content paths (PM JSON, AST via `setComarkAst`) remain synchronous.

## Why register specs in a registry instead of per-extension storage?

Earlier drafts attached a Comark `NodeSpec` / `MarkSpec` to each extension's `addStorage({ comark })`. That worked but coupled the spec to whichever extension instance happened to be in the schema, made it awkward to override stock specs, and forced custom Bold / Italic / Heading reimplementations to keep the storage contract intact.

The current approach decouples the two: `ComarkSerializer.configure({ specs: { nodes, marks } })` carries the dispatch table directly. `ComarkKit` builds it from `comarkSpecs` (the stock set) plus any user-defined components. The benefits compound — we use **stock** `@tiptap/starter-kit` extensions with no schema-side modifications, free-ride on Tiptap upstream maintenance, and stay drop-in compatible with the rest of the Tiptap ecosystem (placeholder, character-count, collaboration, drag-handle, …).

`htmlAttrs` is added once via `addGlobalAttributes`, not per-extension. User components opt in to the same helper (`htmlAttrSpec`) inside their own `addAttributes` because their type names aren't known at the time global attrs are resolved.

## Configuration

```ts
ComarkKit.configure({
  // Forwarded to StarterKit. We always override `codeBlock: false`
  // (replaced with ComarkCodeBlock) and `underline: false` (Comark has
  // no underline mark); user options layer on top.
  starterKit: { heading: { levels: [1, 2, 3] } },

  // Forwarded to TableKit. `false` to omit tables entirely.
  table: { table: { resizable: true } },

  // Forwarded to Image. Inline mode is forced on by default.
  image: { allowBase64: true },

  // Disable comark-specific extensions if your AST never carries them.
  comment: false,
  template: false,

  // User-defined components contributed via defineComarkComponent.
  components: [Alert],

  // Style auto-injection (mirrors @tiptap/core's `injectCSS`).
  serializer: { injectStyles: true, injectNonce: 'csp-token' },
})
```

Most consumers will pass `{ components: [...] }` and leave the rest at defaults.
