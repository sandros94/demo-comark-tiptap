# @comark/tiptap-vue

Vue bindings for [`@comark/tiptap`](../@comark/tiptap/README.md). No UI library dependency, no design-system opinions — just the editor primitives.

A future UI library package will sit on top to provide toolbar/menu/popover styling using their own components.

## What's in the box

- **`useComarkEditor(options)`** — composable returning a Tiptap `Editor` ref pre-configured with `ComarkKit` plus your custom components. Bidirectional sync to a `Ref<ComarkTree>` is opt-in.
- **`<ComarkEditor>`** — thin component wrapping `EditorContent`. Pass either a pre-built editor (`:editor="editor"`) or rely on the built-in `v-model:ast` for the simple case.
- **`defineComarkVueComponent(...)`** — wraps the framework-agnostic `defineComarkComponent` factory with `VueNodeViewRenderer`, so your `nodeView: MyAlertView` declaration becomes a real Vue NodeView in the editor.

## Quick look

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { ComarkEditor, defineComarkVueComponent } from '@comark/tiptap-vue'
import type { ComarkTree } from '@comark/tiptap'
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

## Markdown round-trip

```vue
<ComarkEditor v-model:markdown="md" />
```

Either model — `:ast`, `:markdown`, or `:json` — drives the same internal editor. Bind whichever flavor your app stores.
