import type { Editor } from '@tiptap/vue-3'
import type { ComarkTree, JSONContent, SetComarkContentOptions } from '@comark/tiptap'
import type { AnyExtension } from '@tiptap/core'
import type { AsyncSetterInput, SetterInput, UseComarkEditorOptions } from './use-comark-editor'
import type { ComarkVueComponentExports } from './define-component'

export interface ComarkEditorProps {
  /**
   * Pre-built editor instance. If supplied, the wrapper does NOT spin
   * up its own — useful when the consumer wants full control over the
   * Tiptap `Editor` lifecycle (e.g. for collaborative setups).
   */
  editor?: Editor

  /**
   * Comark AST v-model. Two-way bound: outer changes propagate into
   * the editor, editor updates emit `update:ast`.
   */
  ast?: ComarkTree

  /**
   * Markdown v-model. Same shape as `ast`, just on the markdown
   * surface. Note: writes are async (Comark parses markdown
   * asynchronously); reads land on the editor's `update` event.
   */
  markdown?: string

  /**
   * PM JSON v-model. Bypasses Comark's parser entirely — useful when
   * you already hold structured content.
   */
  json?: JSONContent

  /**
   * Non-reactive initial seed. Used at mount only; later changes are
   * ignored. Prefer one of the v-model props above for live binding.
   */
  initial?: ComarkTree | JSONContent | string

  /** User-defined Comark components from `defineComarkVueComponent`. */
  components?: ReadonlyArray<ComarkVueComponentExports>

  /** Additional Tiptap extensions, appended after the kit. */
  extensions?: ReadonlyArray<AnyExtension>

  /** Forwarded to Tiptap's `Editor` constructor. */
  editorOptions?: UseComarkEditorOptions['editorOptions']

  /** Forwarded to `ComarkKit.configure(...)`. */
  kitOptions?: UseComarkEditorOptions['kitOptions']
}

export interface ComarkEditorEmits {
  (e: 'update:ast', tree: ComarkTree): void
  (e: 'update:markdown', markdown: string): void
  (e: 'update:json', json: JSONContent): void
  (e: 'ready', editor: Editor): void
  (e: 'update', editor: Editor): void
}

export interface ComarkEditorExpose {
  editor: Editor | undefined
  isReady: boolean
  setAst?: (input: SetterInput<ComarkTree>, options?: SetComarkContentOptions) => void
  setMarkdown?: (
    input: AsyncSetterInput<string>,
    options?: SetComarkContentOptions,
  ) => Promise<void>
  setJson?: (input: SetterInput<JSONContent>, options?: SetComarkContentOptions) => void
  setHtml?: (input: SetterInput<string>, options?: SetComarkContentOptions) => void
  getAst?: () => ComarkTree | null
  getMarkdown?: () => Promise<string | null>
  getJson?: () => JSONContent | null
  getHtml?: () => string | null
}

export interface ComarkEditorSlots {
  /**
   * Rendered above the Tiptap content. Receives the live editor (when
   * ready) and an `is-ready` flag so callers can render a toolbar that
   * reacts to mark / node activity once the editor exists.
   */
  default(props: { editor: Editor | undefined; isReady: boolean }): unknown
  /**
   * Rendered while the editor is mounting (Tiptap touches the DOM in
   * its constructor, so SSR / pre-mount renders skip the live
   * component). Falls back to nothing if the slot isn't supplied.
   */
  fallback(): unknown
}
