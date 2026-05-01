export { default as ComarkEditor } from './ComarkEditor.vue'

export type {
  ComarkEditorEmits,
  ComarkEditorExpose,
  ComarkEditorModelModifiers,
  ComarkEditorProps,
  ComarkEditorSlots,
} from './comark-editor.types'

export {
  useComarkEditor,
  type ContentType,
  type ContentValue,
  type SetContentOptions,
  type SetterContext,
  type SetterInput,
  type UseComarkEditorOptions,
  type UseComarkEditorReturn,
} from './use-comark-editor'

export {
  defineComarkVueComponent,
  type ComarkVueComponentDefinition,
  type ComarkVueComponentExports,
} from './define-component'

// Re-export the vue-3 `Editor` class for consumer customization.
export { Editor } from '@tiptap/vue-3'

// Re-export the types most users will need from `@comark/tiptap`.
export type {
  ComarkCommentTuple,
  ComarkElement,
  ComarkElementAttributes,
  ComarkKitOptions,
  ComarkNode,
  ComarkText,
  ComarkTree,
  JSONContent,
  PMMark,
  SetComarkContentOptions,
} from '@comark/tiptap'
