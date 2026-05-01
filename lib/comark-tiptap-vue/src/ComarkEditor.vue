<script setup lang="ts">
import { computed, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import type { ComarkTree, JSONContent } from '@comark/tiptap'
import { useComarkEditor } from './use-comark-editor'
import type {
  ComarkEditorEmits,
  ComarkEditorExpose,
  ComarkEditorProps,
  ComarkEditorSlots,
} from './comark-editor.types'

const props = withDefaults(defineProps<ComarkEditorProps>(), {
  editor: undefined,
})

const emits = defineEmits<ComarkEditorEmits>()

defineSlots<ComarkEditorSlots>()

defineOptions({ inheritAttrs: false })

// JSON-shadow loop guard. Each direction stores the last serialized
// form it saw; equal-shadow writes are skipped. Cheap (PM docs are
// usually small) and it dodges the editor's reconstructed-AST identity
// problem.
let astShadow: string | null = null
let mdShadow: string | null = null
let jsonShadow: string | null = null

const safeJson = (v: unknown): string => {
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

// Pick the seed: any v-model wins over `initial` (an explicit binding
// is always the source of truth at mount time). HTML strings only seed
// via `initial` since they aren't a v-model flavor.
const seedAtMount: ComarkTree | JSONContent | string | undefined =
  props.ast ?? props.markdown ?? props.json ?? props.initial

const internal = props.editor
  ? null
  : useComarkEditor({
      initial: seedAtMount,
      components: props.components,
      extensions: props.extensions,
      kitOptions: props.kitOptions,
      editorOptions: props.editorOptions,
      onCreate: (e) => {
        // Initialize shadows from whatever just got into the editor so
        // the first onUpdate doesn't echo back as a fake change.
        if (props.ast !== undefined) {
          astShadow = safeJson(e.storage.comark.getAst())
        }
        if (props.json !== undefined) {
          jsonShadow = safeJson(e.getJSON())
        }
        if (props.markdown !== undefined) {
          // getMarkdown is async; seed the shadow once it resolves.
          // Any edit that lands before then will re-emit (acceptable —
          // at worst we send one redundant update at startup).
          e.storage.comark.getMarkdown().then((md) => {
            mdShadow = md
          })
        }
        emits('ready', e)
      },
      onUpdate: (e) => {
        emits('update', e)

        if (props.ast !== undefined) {
          const tree = e.storage.comark.getAst()
          const j = safeJson(tree)
          if (j !== astShadow) {
            astShadow = j
            emits('update:ast', tree)
          }
        }
        if (props.json !== undefined) {
          const json = e.getJSON() as JSONContent
          const j = safeJson(json)
          if (j !== jsonShadow) {
            jsonShadow = j
            emits('update:json', json)
          }
        }
        if (props.markdown !== undefined) {
          e.storage.comark
            .getMarkdown()
            .then((md) => {
              if (md !== mdShadow) {
                mdShadow = md
                emits('update:markdown', md)
              }
            })
            .catch(() => {
              /* swallow */
            })
        }
      },
    })

// Outside-in sync: when a bound prop changes from above, push it into
// the editor unless the shadow says we already have it.

watch(
  () => props.ast,
  (next) => {
    if (next === undefined || !internal) return
    const j = safeJson(next)
    if (j === astShadow) return
    astShadow = j
    internal.setAst(next)
  },
)

watch(
  () => props.markdown,
  (next) => {
    if (next === undefined || !internal) return
    if (next === mdShadow) return
    mdShadow = next
    void internal.setMarkdown(next)
  },
)

watch(
  () => props.json,
  (next) => {
    if (next === undefined || !internal) return
    const j = safeJson(next)
    if (j === jsonShadow) return
    jsonShadow = j
    internal.setJson(next)
  },
)

const editorRef = computed<Editor | undefined>(() => props.editor ?? internal?.editor.value)
const isReady = computed(() => editorRef.value !== undefined)

defineExpose<ComarkEditorExpose>({
  editor: editorRef as unknown as Editor | undefined,
  isReady: isReady as unknown as boolean,
  setAst: internal?.setAst,
  setMarkdown: internal?.setMarkdown,
  setJson: internal?.setJson,
  getAst: internal?.getAst,
  getMarkdown: internal?.getMarkdown,
  getJson: internal?.getJson,
})
</script>

<template>
  <div data-comark-editor>
    <slot :editor="editorRef" :is-ready="isReady" />
    <EditorContent
      v-if="editorRef"
      :editor="editorRef"
      data-comark-editor-content
      v-bind="$attrs"
    />
    <slot v-else name="fallback" />
  </div>
</template>
