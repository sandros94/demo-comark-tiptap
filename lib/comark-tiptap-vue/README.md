# @comark/tiptap-vue

Vue bindings for [`@comark/tiptap`](../comark-tiptap). No UI library dependency, no design-system opinions — just the editor primitives.

A future UI library package will sit on top to provide toolbar / menu / popover styling using their own components.

## What's in the box

- **`useComarkEditor(options)`** — composable returning a Tiptap `Editor` ref pre-configured with `ComarkKit` plus your custom components. Bidirectional sync via the imperative `setAst` / `setMarkdown` / `setJson` setters; getters in matching trio.
- **`<ComarkEditor>`** — thin component wrapping `EditorContent`. Pass either a pre-built editor (`:editor="editor"`) or rely on the built-in `v-model:ast` / `:markdown` / `:json` for the simple case.
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
  <ComarkEditor v-model:ast="tree" :components="[Alert]" />
</template>
```

## Three input flavors

```vue
<!-- ComarkTree -->
<ComarkEditor v-model:ast="tree" />

<!-- string (parsed via comark) -->
<ComarkEditor v-model:markdown="md" />

<!-- PM JSON -->
<ComarkEditor v-model:json="doc" />
```

Either model — `:ast`, `:markdown`, or `:json` — drives the same internal editor. Bind whichever flavor your app stores. Combinations work too: bind `:json` for the PM-canonical state and emit `:markdown` for export, etc.

## Async markdown seeds

Markdown seeds — the `:markdown` v-model, `initial: '# …'` on `useComarkEditor`, or any string that ultimately reaches `setContent` — resolve **asynchronously**. `comark.parse` is async-only, so the editor mounts with empty content for one microtask before the parsed AST lands. This is a divergence from projects like [`aguingand/tiptap-markdown`](https://github.com/aguingand/tiptap-markdown) and Tiptap's own `@tiptap/markdown` (both ship synchronous parsers).

The wrapper handles the wait internally: `<ComarkEditor>`'s `ready` / `update:*` events fire when the seed lands, and the default slot's `is-ready` flag flips to `true` at the same moment. Only call sites that read editor state synchronously _after_ mount need to wait one tick.

The AST and JSON seed paths stay synchronous — only string seeds incur the async hop.

## Inline inserts

`@comark/tiptap` overrides `insertContent` / `insertContentAt` so a markdown string is parsed via `comark` instead of HTML — see the base package's README for the full contract. The Vue layer exposes the `Editor` instance via `useComarkEditor()` / `<ComarkEditor>`'s template ref, so the override's `inline` option is reachable directly:

```ts
const wrapper = useTemplateRef<ComarkEditorExpose>('wrapper')
wrapper.value?.editor?.commands.insertContent('**emphasis**', { inline: true })
```

Without `inline: true`, the markdown is wrapped in its parsed block(s) and inserted at the cursor as full blocks. With it, just the inline run lands inline.

## Forwarding kit options

`useComarkEditor` and `<ComarkEditor>` accept a `kitOptions` prop that's forwarded to `ComarkKit.configure(...)` — useful for tweaking StarterKit (`{ starterKit: { heading: { levels: [1, 2] } } }`), turning off tables, configuring image inline mode, etc.

```vue
<ComarkEditor
  v-model:ast="tree"
  :kit-options="{ starterKit: { heading: { levels: [1, 2, 3] } } }"
/>
```
