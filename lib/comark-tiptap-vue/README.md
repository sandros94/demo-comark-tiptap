# @comark/tiptap-vue

Vue bindings for [`@comark/tiptap`](../comark-tiptap). No UI library dependency, no design-system opinions — just the editor primitives.

A future UI library package will sit on top to provide toolbar / menu / popover styling using their own components.

## What's in the box

- **`useComarkEditor(options)`** — composable returning a Tiptap `Editor` ref pre-configured with `ComarkKit` plus your custom components. Single `setContent(value, options?)` setter that dispatches by `contentType`; matching getters in any flavor.
- **`<ComarkEditor>`** — thin component wrapping `EditorContent`. Pass either a pre-built editor (`:editor="editor"`) or rely on the built-in `v-model` for the simple case. Modifiers (`v-model.markdown` / `v-model.html` / `v-model.json` / `v-model.ast`) pick the flavor.
- **`defineComarkVueComponent(...)`** — wraps the framework-agnostic `defineComarkComponent` factory with `VueNodeViewRenderer`, so your `nodeView: MyAlertView` declaration becomes a real Vue NodeView in the editor.

## Quick look

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ComarkEditor, defineComarkVueComponent } from '@comark/tiptap-vue'
import type { ComarkTree } from '@comark/tiptap-vue'
import AlertNodeView from './AlertNodeView.vue'

const Alert = defineComarkVueComponent({
  name: 'alert',
  kind: 'block',
  props: {
    type: { type: 'string', default: 'info' },
    title: { type: 'string' },
  },
  nodeView: AlertNodeView,
})

const tree = ref<ComarkTree>({ nodes: [], frontmatter: {}, meta: {} })
</script>

<template>
  <ComarkEditor v-model.ast="tree" :components="[Alert]" />
</template>
```

## One v-model, four flavors via modifiers

```vue
<!-- markdown (default) -->
<ComarkEditor v-model="md" />
<ComarkEditor v-model.markdown="md" />

<!-- HTML — Tiptap's stock pipeline -->
<ComarkEditor v-model.html="html" />

<!-- PM JSON -->
<ComarkEditor v-model.json="doc" />

<!-- Comark AST -->
<ComarkEditor v-model.ast="tree" />
```

The flavor is the same on the way in and on the way out: `v-model.markdown` accepts a markdown string and emits `update:modelValue` with markdown. `v-model.ast` accepts a `ComarkTree` (or JSON-encoded AST) and emits `ComarkTree`. The component picks the right setter / getter internally.

## `content` vs `v-model`

```vue
<!-- non-reactive seed: applied once at mount, later changes ignored -->
<ComarkEditor :content="seed" />

<!-- reactive bidirectional sync: two-way bound, parent stays in sync -->
<ComarkEditor v-model.markdown="md" />

<!-- both: explicit v-model wins, `content` is ignored when v-model is set -->
<ComarkEditor :content="fallbackSeed" v-model.ast="tree" />
```

Use `content` for one-shot seeding (template defaults, server-rendered fragments, etc.) and v-model for live binding. They're never both consulted past mount: `v-model` takes precedence.

## Composable surface

For non-component consumers, `useComarkEditor` accepts a `MaybeRefOrGetter<ContentValue>` for `content`. Reactive sources are watched and propagated; plain values are mount-only seeds:

```ts
const md = ref('# Hi\n')
const { editor, setContent, getAst, getMarkdown } = useComarkEditor({
  content: md, // ref → live binding
  contentType: 'markdown',
})

// Imperative — single setter, dispatches by contentType.
await setContent('## Replaced\n') // option-level contentType
await setContent('<p>hi</p>', { contentType: 'html' }) // override per call
await setContent(({ content }) => `${content}\n\nappended`) // functional updater
```

Getters cover every flavor and are independent of `contentType`:

```ts
const tree = getAst() // ComarkTree | null
const md = await getMarkdown() // string | null  (async)
const json = getJson() // JSONContent | null
const html = getHtml() // string | null  — pass-through to editor.getHTML()
```

## Async markdown seeds

Markdown seeds resolve **asynchronously**. `comark.parse` is async-only, so the editor mounts with empty content for one microtask before the parsed AST lands. This is a divergence from projects like [`aguingand/tiptap-markdown`](https://github.com/aguingand/tiptap-markdown) and Tiptap's own `@tiptap/markdown` (both ship synchronous parsers).

The wrapper handles the wait internally: `<ComarkEditor>`'s `ready` / `update` events fire when the seed lands, and the default slot's `is-ready` flag flips to `true` at the same moment. Only call sites that read editor state synchronously _after_ mount need to wait one tick.

The AST, JSON, and HTML seed paths stay synchronous — only markdown strings incur the async hop.

## Forwarding kit options

`useComarkEditor` and `<ComarkEditor>` accept a `kitOptions` prop that's forwarded to `ComarkKit.configure(...)` — useful for tweaking StarterKit (`{ starterKit: { heading: { levels: [1, 2] } } }`), turning off tables, configuring image inline mode, etc.

```vue
<ComarkEditor
  v-model.ast="tree"
  :kit-options="{ starterKit: { heading: { levels: [1, 2, 3] } } }"
/>
```
