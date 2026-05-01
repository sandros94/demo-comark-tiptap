<script setup lang="ts">
import { ref } from 'vue'
import { ComarkEditor } from '@comark/tiptap-vue'
import type { ComarkTree } from '@comark/tiptap-vue'

// Minimal Vue-only playground for `@comark/tiptap-vue`. Mirrors the
// surface the Nuxt playground exercises but without `@nuxt/ui`, so the
// types compile without the `@tiptap/markdown` augmentation pulled in
// by Nuxt UI. Useful for verifying the libs in isolation.

const SEED = `# Vue-only playground

A minimal scaffold for **@comark/tiptap-vue**. Edit and watch the AST update.
`

const tree = ref<ComarkTree>({ nodes: [], frontmatter: {}, meta: {} })
</script>

<template>
  <main style="max-width: 720px; margin: 2rem auto; font-family: system-ui, sans-serif">
    <h1>@comark/tiptap-vue — Vue-only playground</h1>

    <ComarkEditor
      v-model.ast="tree"
      :content="SEED"
      style="border: 1px solid #ddd; border-radius: 8px; padding: 1rem"
    />

    <details style="margin-top: 1rem">
      <summary>Comark AST</summary>
      <pre style="overflow: auto; background: #f6f6f6; padding: 0.75rem">{{
        JSON.stringify(tree, null, 2)
      }}</pre>
    </details>
  </main>
</template>
