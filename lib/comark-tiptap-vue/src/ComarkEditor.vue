<script setup lang="ts">
import { computed, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { useComarkEditor, type ContentType, type ContentValue } from './use-comark-editor'
import type {
  ComarkEditorEmits,
  ComarkEditorExpose,
  ComarkEditorModelModifiers,
  ComarkEditorProps,
  ComarkEditorSlots,
} from './comark-editor.types'

const props = withDefaults(defineProps<ComarkEditorProps>(), {
  editor: undefined,
})

const emit = defineEmits<ComarkEditorEmits>()

defineSlots<ComarkEditorSlots>()

defineOptions({ inheritAttrs: false })

// Single v-model surface plus modifier flags to pick the OUTPUT flavor:
// `v-model.markdown="md"` / `v-model.html="h"` / `v-model.json="j"` /
// `v-model.ast="t"`. The modifier controls only how the editor's
// current state is read back to the bound ref. INPUT flavor (used to
// parse `:content`) comes from the `contentType` prop and defaults to
// `'markdown'`. When only `v-model` is bound (no `:content`) the
// modifier covers both directions.
const [model, modelModifiers] = defineModel<ContentValue, string, ComarkEditorModelModifiers>()

function pickModifier(): ContentType | null {
  if (modelModifiers.html) return 'html'
  if (modelModifiers.json) return 'json'
  if (modelModifiers.ast) return 'ast'
  if (modelModifiers.markdown) return 'markdown'
  return null
}

// OUTPUT flavor — drives v-model emit and the watcher that pushes
// outside-in changes back into the editor (since the model's value is
// always in the modifier flavor, in both directions).
const outputFlavor = computed<ContentType>(() => pickModifier() ?? props.contentType ?? 'markdown')

// INPUT flavor — drives how the seed is parsed. When `:content` is
// provided, the contentType prop decides (default `'markdown'`).
// When only `v-model` is bound, fall back to the modifier so the
// initial value's flavor matches the v-model's flavor.
const inputFlavor = computed<ContentType>(() => {
  if (props.content !== undefined) return props.contentType ?? 'markdown'
  return pickModifier() ?? props.contentType ?? 'markdown'
})

// JSON-shadow loop guard. The editor's `update` event fires for both
// user edits AND for the wave we trigger when v-model pushes new
// content in. We stamp every push (in or out) on a shared shadow so
// the round-trip stops here instead of bouncing back to the parent
// and back again.
let shadow: string | null = null
const safeJson = (v: unknown): string => {
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

// Pick the seed: `:content` wins (it's the explicit input). Falls
// back to v-model's initial value when no content prop is bound.
const seedAtMount: ContentValue | undefined =
  props.content !== undefined ? props.content : model.value

const internal = props.editor
  ? null
  : useComarkEditor({
      content: seedAtMount,
      contentType: inputFlavor.value,
      components: props.components,
      extensions: props.extensions,
      kitOptions: props.kitOptions,
      editorOptions: props.editorOptions,
      onCreate: (e) => {
        // Initial v-model sync. Two paths because of the markdown
        // async-parse hop:
        //
        //   - Sync seed flavors (html / json / ast / non-string
        //     markdown): editor state is final by `onCreate`, so we
        //     push into the model immediately. Output flavor !== input
        //     flavor would otherwise leave the bound ref out of sync
        //     until the first user edit.
        //   - Async markdown string: editor isn't populated yet (parse
        //     is pending). Just seed the shadow so the FIRST `onUpdate`
        //     (which fires when the parsed AST lands) does the sync.
        if (model.value !== undefined) {
          const seedIsAsyncMarkdown =
            inputFlavor.value === 'markdown' && typeof seedAtMount === 'string'
          if (seedIsAsyncMarkdown) {
            void initShadow(e)
          } else if (props.content !== undefined) {
            // Cross-flavor case: `:content` was provided, push the
            // editor's current state out via the model.
            void pushModelFromEditor(e)
          } else {
            // Only v-model bound: the seed came from the model itself,
            // so the model already holds it. Just seed the shadow.
            void initShadow(e)
          }
        }
        emit('ready', e)
      },
      onUpdate: (e) => {
        emit('update', e)
        if (model.value === undefined) return
        void pushModelFromEditor(e)
      },
    })

// Read the editor's current content in the output flavor and push it
// to the v-model (with shadow-guarded emit dedup).
async function pushModelFromEditor(e: Editor): Promise<void> {
  if (outputFlavor.value === 'markdown') {
    try {
      const md = await e.storage.comark.getMarkdown()
      if (md === shadow) return
      shadow = md
      model.value = md
    } catch {
      /* swallow — keeping the editor alive matters more than
         surfacing a comark/render error here. */
    }
    return
  }
  const out = readByFlavor(e, outputFlavor.value)
  const j = safeJson(out)
  if (j === shadow) return
  shadow = j
  model.value = out as ContentValue
}

// Seed the shadow without touching the model.
async function initShadow(e: Editor): Promise<void> {
  if (outputFlavor.value === 'markdown') {
    try {
      shadow = await e.storage.comark.getMarkdown()
    } catch {
      shadow = null
    }
    return
  }
  shadow = safeJson(readByFlavor(e, outputFlavor.value))
}

function readByFlavor(e: Editor, ct: ContentType): unknown {
  switch (ct) {
    case 'ast':
      return e.storage.comark.getAst()
    case 'html':
      return e.getHTML()
    case 'json':
      return e.getJSON()
    case 'markdown':
      // markdown is async; handled by the caller separately.
      return null
  }
}

// Outside-in sync: when the bound model changes from above, push it
// into the editor unless the shadow says we already have it. The
// model's value is always in the OUTPUT flavor (= modifier).
watch(
  () => model.value,
  (next) => {
    if (next === undefined) return
    if (!internal) return
    if (outputFlavor.value === 'markdown' && typeof next === 'string') {
      if (next === shadow) return
      shadow = next
    } else {
      const j = safeJson(next)
      if (j === shadow) return
      shadow = j
    }
    void internal.setContent(next, { contentType: outputFlavor.value })
  },
)

const editorRef = computed<Editor | undefined>(() => props.editor ?? internal?.editor.value)
const isReady = computed(() => editorRef.value !== undefined)

defineExpose<ComarkEditorExpose>({
  editor: editorRef as unknown as Editor | undefined,
  isReady: isReady as unknown as boolean,
  setContent: internal?.setContent,
  getAst: internal?.getAst,
  getMarkdown: internal?.getMarkdown,
  getJson: internal?.getJson,
  getHtml: internal?.getHtml,
})
</script>

<template>
  <div data-comark-editor>
    <template v-if="editorRef">
      <slot :editor="editorRef" />
      <EditorContent
        v-if="editorRef"
        :editor="editorRef"
        data-comark-editor-content
        v-bind="$attrs"
      />
    </template>
    <slot v-else name="fallback" />
  </div>
</template>
