<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { parse } from 'comark'
import { defineComarkVueComponent, type ComarkTree } from '@comark/tiptap-vue'
import AlertNodeView from '~/components/AlertNodeView.vue'

const STORAGE_KEY = 'comark-demo-doc'

const SEED_MARKDOWN = `---
title: Comark Editor Demo
author: Demo
---

# Welcome to the Comark editor

Edit this document and reload — your changes are persisted to **localStorage**.

This paragraph mixes **bold**, *italic*, ~~strike~~, and \`inline code\`. There is also a [link to the repo](https://github.com/sandros94/demo-comark-tiptap){target="_blank" rel="noopener"}.

::alert{type="info" title="Heads up"}
This is a **block component** rendered by \`AlertNodeView.vue\`. Try clicking the gear icon in the corner of the alert to edit its props.
::

::alert{type="warning"}
A second alert without a title.
::

## Lists & quotes

- A bullet
- Another bullet
  - Nested
  - Items

1. First
2. Second
3. Third

> Markdown blockquote with **inline marks** and a [link](https://example.com).

## Code with a filename and highlight

\`\`\`ts [example.ts] {2}
const greet = (name: string) => {
  console.log(\`Hello, \${name}!\`)
}
\`\`\`

## Table

| Feature      | Status      |
| ------------ | ----------- |
| Headings     | ✅ Working   |
| Marks        | ✅ Working   |
| Tables       | ✅ Working   |
| Components   | ✅ Working   |

---

That's the demo.
`

const tree = useState<ComarkTree>('comark-demo-tree', () => ({
  nodes: [],
  frontmatter: {},
  meta: {},
}))

const { data: seed } = await useAsyncData('comark-demo-seed', () => parse(SEED_MARKDOWN))

if (seed.value && tree.value.nodes.length === 0) {
  tree.value = seed.value as ComarkTree
}

const Alert = defineComarkVueComponent({
  name: 'alert',
  kind: 'block',
  props: {
    type: { type: 'string', default: 'info' },
    title: { type: 'string' },
  },
  nodeView: AlertNodeView,
})

const components = [Alert]

if (import.meta.client) {
  onMounted(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        tree.value = JSON.parse(saved) as ComarkTree
      } catch {
        // ignore corrupt storage
      }
    }
  })
  watch(
    tree,
    (t) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
      } catch {
        // quota / private mode — ignore
      }
    },
    { deep: true },
  )
}

async function resetToSeed() {
  if (import.meta.client) localStorage.removeItem(STORAGE_KEY)
  tree.value = (await parse(SEED_MARKDOWN)) as ComarkTree
}
</script>

<template>
  <UContainer class="py-6">
    <header class="mb-4 flex items-center justify-between">
      <h1 class="text-2xl font-bold" data-test="editor-heading">Comark editor demo</h1>

      <div class="inline-flex gap-2 lg:gap-4">
        <UButton
          to="https://github.com/sandros94/demo-comark-tiptap"
          target="_blank"
          icon="i-simple-icons-github"
          color="neutral"
          variant="outline"
        />
        <UButton color="neutral" variant="outline" data-test="reset" @click="resetToSeed">
          Reset to seed
        </UButton>
      </div>
    </header>

    <UComarkEditor
      ref="test"
      v-model:ast="tree"
      :components="components"
      class="rounded-lg border border-default p-4 min-h-100 focus:outline-none"
      data-test="editor"
    >
      <template #fallback>
        <div
          class="flex min-h-100 items-center justify-center rounded-lg border border-default p-4 text-muted"
          data-test="editor-fallback"
        >
          Loading editor…
        </div>
      </template>
    </UComarkEditor>

    <details class="mt-6 text-sm">
      <summary class="cursor-pointer font-medium">Comark AST (debug)</summary>
      <pre
        class="mt-2 max-h-96 overflow-auto rounded bg-elevated p-3 text-xs"
        data-test="comark-ast"
        >{{ JSON.stringify(tree, null, 2) }}</pre
      >
    </details>
  </UContainer>
</template>
