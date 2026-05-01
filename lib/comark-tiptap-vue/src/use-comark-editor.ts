import type { AnyExtension, Content, EditorOptions } from '@tiptap/core'
import { Editor } from '@tiptap/vue-3'
import {
  ComarkKit,
  type ComarkKitOptions,
  type ComarkTree,
  type JSONContent,
  type SetComarkContentOptions,
} from '@comark/tiptap'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  type ComputedRef,
  type ShallowRef,
} from 'vue'
import type { ComarkVueComponentExports } from './define-component'

export interface UseComarkEditorOptions {
  /**
   * Initial document. Read once at mount; not reactive. Accepts a Comark
   * AST (`{ nodes, frontmatter, meta }`), PM JSON, or a markdown string
   * (parsed via Comark, async). To replace content reactively after
   * mount, call `setAst` / `setMarkdown` / `setJson`.
   */
  initial?: ComarkTree | JSONContent | string

  /** User-defined Comark components (block or inline). Read once at mount. */
  components?: ReadonlyArray<ComarkVueComponentExports>

  /** Additional Tiptap extensions, appended after the kit. Read once at mount. */
  extensions?: ReadonlyArray<AnyExtension>

  /**
   * Forwarded to `ComarkKit.configure(...)`. Use this to tweak
   * StarterKit (`{ starterKit: { heading: false } }`), tables
   * (`{ table: false }`), images, the serializer's `injectStyles`
   * setting, etc.
   *
   * `components` from this object is merged with the top-level
   * `components` option for convenience.
   */
  kitOptions?: Partial<ComarkKitOptions>

  /**
   * Forwarded to Tiptap's `Editor` constructor. Use it for
   * `editorProps`, `editable`, `injectCSS`, custom `parseOptions`, etc.
   * Schema-related options (extensions, content) and lifecycle hooks
   * (onCreate / onUpdate / onDestroy) are managed by this composable.
   */
  editorOptions?: Omit<
    Partial<EditorOptions>,
    'extensions' | 'content' | 'onCreate' | 'onUpdate' | 'onDestroy'
  >

  /** Called once when the editor instance has been created. */
  onCreate?: (editor: Editor) => void
  /** Called on every transaction that changes the document. */
  onUpdate?: (editor: Editor) => void
  /** Called when the editor instance is being destroyed. */
  onDestroy?: () => void
}

/**
 * Setter context — passed to the functional-update form of `setAst` /
 * `setMarkdown` / `setJson`. Lets the caller derive the next value from
 * the current state without an extra `getAst()` round-trip.
 */
export interface SetterContext<T> {
  /** Current content in the setter's flavor. */
  content: T
  /** The live editor instance. */
  editor: Editor
}

/** A direct value or a functional update of the current state. */
export type SetterInput<T> = T | ((ctx: SetterContext<T>) => T)
/** Async-aware variant for markdown (where reading is async). */
export type AsyncSetterInput<T> = T | ((ctx: SetterContext<T>) => T | Promise<T>)

export interface UseComarkEditorReturn {
  /** Tiptap editor instance. `undefined` until mount. */
  editor: ShallowRef<Editor | undefined>
  /** True once the editor instance is constructed. */
  isReady: ComputedRef<boolean>

  /**
   * Replace content from a Comark AST (or derive it from the current
   * state). `options` is forwarded to `commands.setComarkAst` — pass
   * `{ emitUpdate: false }` to apply silently, etc.
   */
  setAst: (input: SetterInput<ComarkTree>, options?: SetComarkContentOptions) => void
  /**
   * Replace content from markdown (or derive it from the current
   * state). `options` is forwarded to `commands.setComarkMarkdown`.
   */
  setMarkdown: (input: AsyncSetterInput<string>, options?: SetComarkContentOptions) => Promise<void>
  /**
   * Replace content from PM JSON (or derive it from the current state).
   * `options` is forwarded to `commands.setContent`; only `emitUpdate`
   * and `errorOnInvalidContent` are honored — `parseOptions` is omitted
   * since PM JSON does not flow through the HTML parser.
   */
  setJson: (input: SetterInput<JSONContent>, options?: SetComarkContentOptions) => void

  /** Read the current state in any flavor. Returns `null` until ready. */
  getAst: () => ComarkTree | null
  getMarkdown: () => Promise<string | null>
  getJson: () => JSONContent | null
}

export function useComarkEditor(options: UseComarkEditorOptions = {}): UseComarkEditorReturn {
  const {
    initial,
    components = [],
    extensions = [],
    kitOptions,
    editorOptions,
    onCreate,
    onUpdate,
    onDestroy,
  } = options

  const editor = shallowRef<Editor | undefined>(undefined)

  const mergedComponents = [
    ...components,
    ...((kitOptions?.components as ReadonlyArray<ComarkVueComponentExports> | undefined) ?? []),
  ]
  const allExtensions: AnyExtension[] = [
    ComarkKit.configure({
      ...kitOptions,
      components: mergedComponents,
    }),
    ...extensions,
  ]

  // Comark trees and PM JSON go through dedicated commands after the
  // editor is mounted; only HTML / markdown strings flow into Tiptap's
  // own constructor `content` slot. The serializer's onBeforeCreate
  // hook intercepts string content there and reroutes through Comark.
  const initialContent: Content | undefined = isComarkTreeLike(initial)
    ? undefined
    : (initial as Content | undefined)

  // Tiptap touches the DOM during construction — defer to client mount.
  onMounted(() => {
    const instance = new Editor({
      ...editorOptions,
      extensions: allExtensions,
      content: initialContent,
      onCreate({ editor: e }) {
        onCreate?.(e as Editor)
      },
      onUpdate({ editor: e }) {
        onUpdate?.(e as Editor)
      },
      onDestroy() {
        onDestroy?.()
      },
    })

    // Apply the initial Comark tree synchronously, BEFORE assigning
    // `editor.value`. Two reasons:
    //   1. Tiptap dispatches its own `create` event asynchronously
    //      (via `setTimeout(0)` inside the constructor). Applying
    //      initial content from `onCreate` would land *after* the
    //      consuming component's `onMounted` runs, racing any
    //      prop-driven setter the consumer kicks off there.
    //   2. We pass `emitUpdate: false` because the consumer already
    //      holds this value — it IS the seed they passed in. Echoing
    //      it back as an `update` event could propagate as a fake
    //      change and clobber whatever they bind it to.
    if (isComarkTreeLike(initial)) {
      instance.commands.setComarkAst(initial as ComarkTree, { emitUpdate: false })
    }

    editor.value = instance
  })

  onBeforeUnmount(() => {
    editor.value?.destroy()
  })

  // Setters — direct value or functional-update callback. `options` is
  // forwarded to the underlying Tiptap command so callers can control
  // `emitUpdate` / `errorOnInvalidContent` per-call.

  const setAst = (input: SetterInput<ComarkTree>, options?: SetComarkContentOptions): void => {
    const e = editor.value
    if (!e) return
    const next =
      typeof input === 'function' ? input({ content: e.storage.comark.getAst(), editor: e }) : input
    e.commands.setComarkAst(next, options)
  }

  const setMarkdown = async (
    input: AsyncSetterInput<string>,
    options?: SetComarkContentOptions,
  ): Promise<void> => {
    const e = editor.value
    if (!e) return
    let next: string
    if (typeof input === 'function') {
      const current = await e.storage.comark.getMarkdown()
      next = await input({ content: current, editor: e })
    } else {
      next = input
    }
    e.commands.setComarkMarkdown(next, options)
  }

  const setJson = (input: SetterInput<JSONContent>, options?: SetComarkContentOptions): void => {
    const e = editor.value
    if (!e) return
    const next =
      typeof input === 'function'
        ? input({ content: e.getJSON() as JSONContent, editor: e })
        : input
    e.commands.setContent(next as Content, {
      emitUpdate: options?.emitUpdate ?? true,
      errorOnInvalidContent: options?.errorOnInvalidContent,
    })
  }

  // Getters

  const getAst = (): ComarkTree | null => editor.value?.storage.comark.getAst() ?? null
  const getMarkdown = (): Promise<string | null> =>
    editor.value?.storage.comark.getMarkdown() ?? Promise.resolve(null)
  const getJson = (): JSONContent | null =>
    (editor.value?.getJSON() as JSONContent | undefined) ?? null

  const isReady = computed(() => editor.value !== undefined)

  return { editor, isReady, setAst, setMarkdown, setJson, getAst, getMarkdown, getJson }
}

// #region internals

function isComarkTreeLike(v: unknown): v is ComarkTree {
  return (
    !!v &&
    typeof v === 'object' &&
    'nodes' in (v as Record<string, unknown>) &&
    Array.isArray((v as { nodes: unknown }).nodes)
  )
}
