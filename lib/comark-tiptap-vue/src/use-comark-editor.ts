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
  isRef,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  toValue,
  watch,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue'
import type { ComarkVueComponentExports } from './define-component'

/**
 * Vue-layer content flavor. Drives both input dispatch (which command
 * to call) and output read-back (which getter to use).
 *
 *   - `'markdown'` (default) — `comark.parse` (async) on input,
 *      `getMarkdown()` on output. `string` value type.
 *   - `'html'`               — Tiptap's stock HTML pipeline. `string`
 *      value type.
 *   - `'json'`               — strict PM JSON. `JSONContent` (object)
 *      or JSON-encoded `string` value type.
 *   - `'ast'`                — Comark AST. `ComarkTree` object or
 *      JSON-encoded `string` value type. Routes to `setComarkAst` /
 *      `getAst` (no global `contentType` augmentation involved, so
 *      it's safe alongside `@tiptap/markdown`).
 *
 * `'ast'` is Vue-layer only. The libraries below it accept its inputs
 * via the explicit `setComarkAst(value)` command, which takes both
 * `ComarkTree` and JSON-encoded strings.
 */
export type ContentType = 'markdown' | 'html' | 'json' | 'ast'

/**
 * Anything that can serve as `content`. The composable accepts the
 * three flavor-relevant shapes and routes by `contentType`.
 *
 * Wrap in a `Ref` / getter for reactive bidirectional sync (every
 * change pushes into the editor); pass a plain value for an
 * initial-only seed.
 */
export type ContentValue = ComarkTree | JSONContent | string

export interface UseComarkEditorOptions {
  /**
   * Initial / reactive document. Resolved through Vue's `toValue` —
   * pass a `Ref<T>` or `() => T` for live binding (changes propagate
   * into the editor), or a plain value for a one-shot mount-time seed.
   *
   * Object inputs are auto-detected on bare `setContent` (`ComarkTree`
   * shapes route through `setComarkAst`); string inputs follow
   * `contentType`.
   */
  content?: MaybeRefOrGetter<ContentValue | undefined>

  /**
   * Flavor of the bound `content`. Drives both input dispatch (which
   * underlying command runs) and the output flavor used by
   * `<ComarkEditor>` for emit.
   *
   * @default 'markdown'
   */
  contentType?: ContentType

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
 * Setter context — passed to the functional-update form of
 * `setContent`. Lets the caller derive the next value from the current
 * state without an extra `getXxx()` round-trip.
 */
export interface SetterContext<T> {
  /** Current content read in the requested flavor. */
  content: T
  /** The live editor instance. */
  editor: Editor
}

export type SetterInput<T> = T | ((ctx: SetterContext<T>) => T | Promise<T>)

export interface SetContentOptions extends SetComarkContentOptions {
  /**
   * Override the composable-level `contentType` for this single call.
   * Useful in toolbars that need to set HTML for one paste handler
   * while the bound model stays in markdown, etc.
   */
  contentType?: ContentType
}

export interface UseComarkEditorReturn {
  /** Tiptap editor instance. `undefined` until mount. */
  editor: ShallowRef<Editor | undefined>
  /** True once the editor instance is constructed. */
  isReady: ComputedRef<boolean>

  /**
   * Replace content. Routes by `contentType` (option-level default,
   * overridable per call). Accepts either a value or a functional
   * updater that receives the current content in the matching flavor.
   *
   * Returns a `Promise<void>` because the markdown path is async; for
   * other flavors the promise resolves on the same microtask.
   */
  setContent: (input: SetterInput<ContentValue>, options?: SetContentOptions) => Promise<void>

  /** Read the current state in any flavor. Returns `null` until ready. */
  getAst: () => ComarkTree | null
  getMarkdown: () => Promise<string | null>
  getJson: () => JSONContent | null
  /**
   * Read the current state as HTML — pure pass-through to Tiptap's
   * `editor.getHTML()`. NOTE: components that ship a framework-rendered
   * NodeView (e.g. `defineComarkVueComponent({ nodeView })`) emit only
   * the generic `<div data-comark-component="...">` marker here, not
   * the framework-rendered output. For lossless export prefer
   * `getMarkdown()` or `getAst()`.
   */
  getHtml: () => string | null
}

const DEFAULT_CONTENT_TYPE: ContentType = 'markdown'

/**
 * Apply a content value to the editor with the right command for the
 * requested flavor. Centralised so `setContent` and the prop-driven
 * watcher use exactly the same dispatch.
 */
function applyContent(
  editor: Editor,
  value: ContentValue,
  contentType: ContentType,
  options: SetComarkContentOptions = {},
): void {
  const baseOpts = {
    emitUpdate: options.emitUpdate ?? true,
    errorOnInvalidContent: options.errorOnInvalidContent,
  }
  switch (contentType) {
    case 'ast':
      // setComarkAst handles both ComarkTree objects and JSON-encoded
      // strings; PM JSON / markdown shapes here would be a misuse and
      // return false.
      editor.commands.setComarkAst(value as ComarkTree | string, baseOpts)
      return
    case 'markdown':
      // String → comark.parse (async). Object content with a
      // 'markdown' contentType is unusual; rather than misroute it we
      // fall through to setContent which auto-detects ComarkTree
      // objects and otherwise treats it as PM JSON.
      if (typeof value === 'string') {
        editor.commands.setComarkMarkdown(value, baseOpts)
      } else {
        editor.commands.setContent(value as Content, baseOpts)
      }
      return
    case 'html':
      editor.commands.setContent(value as Content, { ...baseOpts, contentType: 'html' })
      return
    case 'json':
      editor.commands.setContent(value as Content, { ...baseOpts, contentType: 'json' })
      return
  }
}

/** Read the current editor content in the requested flavor. */
function readContent(editor: Editor, contentType: ContentType): ContentValue | null {
  switch (contentType) {
    case 'ast':
      return editor.storage.comark.getAst()
    case 'markdown':
      // Reads are async only on the markdown path; we return a Promise
      // here would force callers to await every read. The setter's
      // functional-updater form awaits the promise itself.
      return null
    case 'html':
      return editor.getHTML()
    case 'json':
      return editor.getJSON() as JSONContent
  }
}

export function useComarkEditor(options: UseComarkEditorOptions = {}): UseComarkEditorReturn {
  const {
    content,
    contentType = DEFAULT_CONTENT_TYPE,
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

  // Resolve the initial seed once. Reactive sources are watched
  // post-mount; this captures the value at construction time.
  const initialValue = toValue(content)

  // Decide whether the seed flows through Tiptap's constructor or via
  // a separate `setComarkAst` call after mount. Two cases need the
  // explicit-AST path:
  //   - `contentType: 'ast'` (with either an object or a JSON-encoded
  //     string): Tiptap's stock `contentType` enum doesn't include
  //     `'ast'`, so passing it to the constructor would either error
  //     or be silently misinterpreted as markdown.
  //   - object input that auto-detects as a `ComarkTree`: not a shape
  //     Tiptap's constructor knows how to consume.
  const useAstSeed =
    initialValue !== undefined && (contentType === 'ast' || isComarkTreeLike(initialValue))

  const tiptapContent: Content | undefined = useAstSeed
    ? undefined
    : ((initialValue as Content | undefined) ?? undefined)

  const tiptapContentType: 'markdown' | 'html' | 'json' | undefined =
    initialValue === undefined || useAstSeed
      ? undefined
      : (contentType as 'markdown' | 'html' | 'json')

  // Tiptap touches the DOM during construction — defer to client mount.
  onMounted(() => {
    const instance = new Editor({
      ...editorOptions,
      extensions: allExtensions,
      content: tiptapContent,
      // The serializer's `onBeforeCreate` reads `editor.options.contentType`
      // and dispatches per branch. We forward our flavor through except
      // for 'ast' (handled manually below) and the no-seed case.
      ...(tiptapContentType ? { contentType: tiptapContentType } : {}),
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

    // Apply a Comark AST (object or JSON-encoded string) synchronously,
    // BEFORE assigning `editor.value`. Two reasons:
    //   1. Tiptap dispatches its own `create` event asynchronously
    //      (via `setTimeout(0)` inside the constructor). Applying
    //      initial content from `onCreate` would land *after* the
    //      consuming component's `onMounted` runs, racing any
    //      prop-driven setter the consumer kicks off there.
    //   2. We pass `emitUpdate: false` because direct composable
    //      consumers don't expect the seed itself to fire their
    //      `onUpdate` hook. The component layer (`<ComarkEditor>`)
    //      handles its own initial v-model sync via `onCreate` since
    //      it can't rely on `update` here.
    if (initialValue !== undefined && (contentType === 'ast' || isComarkTreeLike(initialValue))) {
      instance.commands.setComarkAst(initialValue as ComarkTree | string, { emitUpdate: false })
    }

    editor.value = instance

    // Reactive content: watch for outer changes and push them in.
    // Plain values (no ref/getter) are caught at mount above and never
    // re-applied. We only set up the watcher when the source is
    // actually reactive, so non-reactive consumers don't pay the cost.
    if (isRef(content) || typeof content === 'function') {
      watch(
        () => toValue(content as MaybeRefOrGetter<ContentValue | undefined>),
        (next) => {
          if (next === undefined) return
          if (instance.isDestroyed) return
          applyContent(instance, next, contentType)
        },
      )
    }
  })

  onBeforeUnmount(() => {
    editor.value?.destroy()
  })

  // Imperative setter — accepts a value or a functional updater.
  const setContent = async (
    input: SetterInput<ContentValue>,
    callOptions: SetContentOptions = {},
  ): Promise<void> => {
    const e = editor.value
    if (!e) return
    const ct = callOptions.contentType ?? contentType
    let next: ContentValue
    if (typeof input === 'function') {
      const current =
        ct === 'markdown'
          ? ((await e.storage.comark.getMarkdown()) as ContentValue)
          : (readContent(e, ct) as ContentValue)
      next = await (
        input as (ctx: SetterContext<ContentValue>) => ContentValue | Promise<ContentValue>
      )({
        content: current,
        editor: e,
      })
    } else {
      next = input
    }
    applyContent(e, next, ct, callOptions)
  }

  // Getters

  const getAst = (): ComarkTree | null => editor.value?.storage.comark.getAst() ?? null
  const getMarkdown = (): Promise<string | null> =>
    editor.value?.storage.comark.getMarkdown() ?? Promise.resolve(null)
  const getJson = (): JSONContent | null =>
    (editor.value?.getJSON() as JSONContent | undefined) ?? null
  const getHtml = (): string | null => editor.value?.getHTML() ?? null

  const isReady = computed(() => editor.value !== undefined)

  return {
    editor,
    isReady,
    setContent,
    getAst,
    getMarkdown,
    getJson,
    getHtml,
  }
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
