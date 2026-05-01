<script setup lang="ts">
import { computed, useAttrs, useTemplateRef, type ComputedRef } from 'vue'
import defu from 'defu'
import { Primitive } from 'reka-ui'
import editorTheme from '#build/ui/editor'
import { tv } from '@nuxt/ui/runtime/utils/tv.js'
import { useComponentUI } from '@nuxt/ui/composables'
import { useAppConfig } from '#imports'
import {
  ComarkEditor,
  type Editor,
  type ComarkEditorSlots,
  type ComarkEditorExpose,
} from '@comark/tiptap-vue'
import type {
  AsyncSetterInput,
  ComarkTree,
  ComarkVueComponentExports,
  JSONContent,
  SetComarkContentOptions,
  SetterInput,
  UseComarkEditorOptions,
} from '@comark/tiptap-vue'
import type { AnyExtension } from '@tiptap/core'

interface UiSlots {
  root?: string
  content?: string
  base?: string
}

interface Props {
  /** Inherits `<ComarkEditor>`'s seed/v-model surface verbatim. */
  initial?: ComarkTree | JSONContent | string
  ast?: ComarkTree
  markdown?: string
  json?: JSONContent
  components?: ReadonlyArray<ComarkVueComponentExports>
  extensions?: ReadonlyArray<AnyExtension>
  editorOptions?: UseComarkEditorOptions['editorOptions']
  as?: string
  class?: string
  ui?: UiSlots
  /** Forwarded to the editor theme's `placeholderMode` variant. */
  placeholderMode?: 'firstLine' | 'everyLine'
}

const props = withDefaults(defineProps<Props>(), {
  as: 'div',
})

const emits = defineEmits<{
  'update:ast': [tree: ComarkTree]
  'update:markdown': [markdown: string]
  'update:json': [json: JSONContent]
  'ready': [editor: Editor]
  'update': [editor: Editor]
}>()

defineSlots<ComarkEditorSlots>()

defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
const appConfig = useAppConfig()

const inner = useTemplateRef<ComarkEditorExpose | null>('inner')

type EditorTv = (variants?: { placeholderMode?: 'firstLine' | 'everyLine' }) => {
  root: (opts?: { class?: unknown }) => string
  base: (opts?: { class?: unknown }) => string
  content: (opts?: { class?: unknown }) => string
}
const uiProp = useComponentUI('editor', props) as unknown as ComputedRef<UiSlots | undefined>
const ui = computed(() => {
  const editorOverrides = (appConfig.ui as { editor?: object } | undefined)?.editor
  const tvFn = tv({ extend: tv(editorTheme), ...editorOverrides }) as unknown as EditorTv
  return tvFn({ placeholderMode: props.placeholderMode })
})

const editorOptions = computed<UseComarkEditorOptions['editorOptions']>(() =>
  defu(props.editorOptions, {
    editorProps: {
      attributes: {
        class: ui.value.base({ class: uiProp.value?.base }),
      },
    },
  }),
)

const contentBindings = computed(() => ({
  ...attrs,
  class: ui.value.content({ class: uiProp.value?.content }),
}))

const editor = computed<Editor | undefined>(() => inner.value?.editor)
const isReady = computed<boolean>(() => inner.value?.isReady ?? false)

defineExpose<ComarkEditorExpose>({
  editor: editor as unknown as Editor | undefined,
  isReady: isReady as unknown as boolean,
  setAst: (input: SetterInput<ComarkTree>, options?: SetComarkContentOptions) =>
    inner.value?.setAst?.(input, options),
  setMarkdown: (input: AsyncSetterInput<string>, options?: SetComarkContentOptions) =>
    inner.value?.setMarkdown?.(input, options) ?? Promise.resolve(),
  setJson: (input: SetterInput<JSONContent>, options?: SetComarkContentOptions) =>
    inner.value?.setJson?.(input, options),
  setHtml: (input: SetterInput<string>, options?: SetComarkContentOptions) =>
    inner.value?.setHtml?.(input, options),
  getAst: () => inner.value?.getAst?.() ?? null,
  getMarkdown: () => inner.value?.getMarkdown?.() ?? Promise.resolve(null),
  getJson: () => inner.value?.getJson?.() ?? null,
  getHtml: () => inner.value?.getHtml?.() ?? null,
})
</script>

<template>
  <Primitive :as="as" data-slot="root" :class="ui.root({ class: [uiProp?.root, props.class] })">
    <ComarkEditor
      ref="inner"
      :ast="props.ast"
      :markdown="props.markdown"
      :json="props.json"
      :initial="props.initial"
      :components="props.components"
      :extensions="props.extensions"
      :editor-options="editorOptions"
      v-bind="contentBindings"
      @update:ast="(tree) => emits('update:ast', tree)"
      @update:markdown="(md) => emits('update:markdown', md)"
      @update:json="(json) => emits('update:json', json)"
      @ready="(e) => emits('ready', e)"
      @update="(e) => emits('update', e)"
    >
      <template v-for="(_, name) in $slots" :key="name" #[name]="slotProps">
        <!-- @vue-ignore: dynamic slot forwarding -->
        <slot :name="name" v-bind="slotProps ?? {}" />
      </template>
    </ComarkEditor>
  </Primitive>
</template>
