import type { AnyExtension } from '@tiptap/core'
import type { Editor } from '@tiptap/vue-3'
import type { ComarkTree, JSONContent } from '@comark/tiptap'
import type { UnwrapRef } from 'vue'
import type { UseComarkEditorOptions, UseComarkEditorReturn } from './use-comark-editor'
import type { ComarkVueComponentExports } from './define-component'

type MaybeUndefined<T extends object, TKept extends keyof T> = {
  [K in keyof T as K extends TKept ? never : K]: UnwrapRef<T[K]> | undefined
} & {
  [K in TKept]: UnwrapRef<T[K]>
}

export interface ComarkEditorProps {
  /** Bring-your-own editor instance (skips internal `useComarkEditor`). */
  editor?: Editor | undefined
  /**
   * Initial document — read once at mount. Not reactive. To replace
   * content later, use a `v-model:*` binding or the editor's setters
   * exposed via the slot / template ref.
   */
  initial?: ComarkTree | JSONContent | string
  /** Two-way bind a Comark AST. */
  ast?: ComarkTree
  /** Two-way bind a markdown string. */
  markdown?: string
  /** Two-way bind a PM JSON document. */
  json?: JSONContent
  /** User-defined Comark components (block or inline). */
  components?: ReadonlyArray<ComarkVueComponentExports>
  /** Additional Tiptap extensions (appended after the kit). */
  extensions?: ReadonlyArray<AnyExtension>
  /** Pass-through for `useComarkEditor` advanced options. */
  editorOptions?: UseComarkEditorOptions['editorOptions']
}

export interface ComarkEditorEmits {
  /** v-model:ast — fired on every transaction that changes the document. */
  'update:ast': [tree: ComarkTree]
  /** v-model:markdown — fired on every transaction. */
  'update:markdown': [markdown: string]
  /** v-model:json — fired on every transaction. */
  'update:json': [json: JSONContent]
  /** Editor instance, fired once after construction. */
  'ready': [editor: Editor]
  /** Catch-all update event with the editor instance. */
  'update': [editor: Editor]
}

export interface ComarkEditorSlots {
  default(props: { editor: Editor | undefined; isReady: boolean }): unknown
  fallback(): unknown
}

/**
 * Runtime shape of `<ComarkEditor>` accessible via `templateRef.value`.
 * `editor` and `isReady` are always present (they live on the wrapper);
 * the imperative setter / getter functions are only exposed when the
 * component owns its `useComarkEditor` instance (`prop.editor` not set).
 */
export interface ComarkEditorExpose extends MaybeUndefined<
  UseComarkEditorReturn,
  'editor' | 'isReady'
> {}
