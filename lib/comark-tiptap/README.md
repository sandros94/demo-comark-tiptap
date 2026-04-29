# @comark/tiptap

A complete Tiptap editor schema for [Comark](https://github.com/comark/comark) documents.

The PM JSON shape, the Comark AST, and the markdown string are three views of the same document. Round-trip is lossless because the schema covers every Comark feature directly — `class`/`id`/`style`/`data-*`/`aria-*` are native PM attrs on nodes _and_ marks; tables, slot templates, comments, and components are first-class node types; nothing rides on a generic carrier object.

## Status

Work in progress. The kit is being experimented inside this repository before being lifted into the upstream Comark monorepo.

## Quick look

```ts
import { Editor } from '@tiptap/core'
import { ComarkKit, ComarkComponent } from '@comark/tiptap'

const editor = new Editor({
  extensions: [
    ComarkKit,
    ComarkComponent.create({ name: 'alert', kind: 'block', schema, nodeView }),
  ],
})

editor.commands.setComarkMarkdown('# Hello\n\n::alert\nHi\n::')
editor.commands.setComarkAst(tree)

editor.storage.comark.getMarkdown() // -> string
editor.storage.comark.getAst() // -> ComarkTree
```

## Strings are markdown

`@comark/tiptap` is opinionated: in this kit, **strings are markdown — never HTML**. The `ComarkSerializer` extension overrides Tiptap's `setContent`, `insertContent`, and `insertContentAt` so a string argument always flows through `comark.parse`. Pre-parsed content (PM JSON, `Fragment`, `ProseMirrorNode`) passes through untouched, so callers that already hold structured content keep Tiptap's synchronous behavior. The empty string falls through too, which preserves `clearContent()`'s sync semantics.

```ts
new Editor({ extensions: [ComarkKit], content: '# Hi' }) // markdown
editor.commands.setContent('## Section\n\n- a\n- b') // markdown
editor.commands.insertContent('**bold**', { inline: true }) // inline run
editor.commands.insertContentAt(pos, '## new section') // block insert
```

If you genuinely need to seed HTML, pre-parse it yourself (e.g. via Tiptap's `generateJSON(html, extensions)`) and pass the resulting JSON. Strings have no escape hatch — that's by design.

### `inline: true`

By default, an `insertContent('**bold**')` call wraps the parsed markdown in a paragraph and inserts that as a block. Pass `{ inline: true }` to flatten the block structure and drop just the inline run at the cursor:

```ts
editor.commands.insertContent('**emphasis** added', { inline: true })
```

Multi-paragraph markdown passed with `inline: true` is bridged with `hardBreak` so source paragraph boundaries survive the flatten — `'a\n\nb'` becomes `a` + `hardBreak` + `b`, not `ab`. Works the same on `insertContentAt(pos, md, { inline: true })`.

### Async seed — a divergence from upstream

`comark.parse` is asynchronous, so when `setContent` / `insertContent` / `new Editor({ content })` receive a markdown string, the command returns `true` synchronously but the actual content application lands one microtask later. This differs from projects like [`aguingand/tiptap-markdown`](https://github.com/aguingand/tiptap-markdown) and Tiptap's own `@tiptap/markdown` (both ship sync parsers, so their seed completes before the constructor returns).

In practice that means: don't read `editor.getJSON()` immediately after a markdown string seed — listen on `editor.on('update', …)` or wait one tick first. Object content paths (PM JSON, AST via `setComarkAst`) remain synchronous.

## Why a complete kit?

Trying to bolt Comark's expressiveness onto Tiptap's StarterKit defaults forced information into a `comarkExtras` carrier — clean for round-trip but second-class in the schema. ProseMirror has always allowed nodes _and_ marks to declare any attributes they want; Tiptap exposes that via `Mark.create({ addAttributes() })`.
This kit takes the obvious option: declare the schema Comark actually needs.
