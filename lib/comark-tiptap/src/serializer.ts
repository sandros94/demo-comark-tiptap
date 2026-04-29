import {
  Extension,
  commands as tiptapCommands,
  type AnyExtension,
  type Content,
  type Editor,
  type JSONContent,
} from '@tiptap/core'
import { parse } from 'comark'
import { renderMarkdown } from 'comark/render'
import { injectComarkStyles } from './style'
import type {
  ComarkComment,
  ComarkElement,
  ComarkHelpers,
  ComarkNode,
  ComarkTree,
  MarkSpec,
  NodeSpec,
  PMMark,
} from './types'

// Tiptap's core command factories. The .d.ts re-exports each one at the
// top level, but the bundled runtime only exposes them on the `commands`
// namespace — destructure here so the override implementations read
// cleanly and the failure mode is loud (typecheck) if Tiptap ever moves
// them.
const {
  setContent: baseSetContent,
  insertContent: baseInsertContent,
  insertContentAt: baseInsertContentAt,
} = tiptapCommands

// #region pure dispatcher

export interface SerializerSpecs {
  nodes: readonly NodeSpec[]
  marks: readonly MarkSpec[]
}

const TEXT_PM_NAME = 'text'
const DOC_PM_NAME = 'doc'

const isComarkText = (n: ComarkNode): n is string => typeof n === 'string'
const isComarkComment = (n: ComarkNode): n is ComarkComment => Array.isArray(n) && n[0] === null
const isComarkElement = (n: ComarkNode): n is ComarkElement =>
  Array.isArray(n) && typeof n[0] === 'string'

/**
 * Build the recursion helpers from a flat list of node / mark specs. Pure
 * function — call it once and reuse the helpers.
 */
export function createSerializer(specs: SerializerSpecs): ComarkHelpers {
  const nodeByPmName = new Map<string, NodeSpec>()
  const nodeByTag = new Map<string, NodeSpec[]>()
  const markByPmName = new Map<string, MarkSpec>()
  const markByTag = new Map<string, MarkSpec[]>()

  for (const spec of specs.nodes) {
    nodeByPmName.set(spec.pmName, spec)
    for (const tag of spec.tags) {
      const list = nodeByTag.get(tag) ?? []
      list.push(spec)
      nodeByTag.set(tag, list)
    }
  }
  for (const spec of specs.marks) {
    markByPmName.set(spec.pmName, spec)
    for (const tag of spec.tags) {
      const list = markByTag.get(tag) ?? []
      list.push(spec)
      markByTag.set(tag, list)
    }
  }

  function pickNodeForTag(el: ComarkElement): NodeSpec | undefined {
    const candidates = nodeByTag.get(el[0])
    if (!candidates) return undefined
    if (candidates.length === 1) return candidates[0]
    return candidates.find((c) => !c.matches || c.matches(el)) ?? candidates[0]
  }

  function pickMarkForTag(el: ComarkElement): MarkSpec | undefined {
    const candidates = markByTag.get(el[0])
    if (!candidates) return undefined
    return candidates[0]
  }

  /**
   * Is a Comark element inline-context? True for marks (always inline) and
   * for any node spec that declared `context: 'inline'` (hardBreak, image,
   * inline-kind components).
   */
  function isInlineComarkElement(el: ComarkElement): boolean {
    if (pickMarkForTag(el)) return true
    const node = pickNodeForTag(el)
    return node?.context === 'inline'
  }

  // PM JSON → Comark

  function serializeBlocks(content: JSONContent[] | undefined): ComarkNode[] {
    if (!content) return []
    const out: ComarkNode[] = []
    for (const child of content) {
      if (!child.type) continue
      const spec = nodeByPmName.get(child.type)
      if (!spec) continue
      const result = spec.toComark(child, helpers)
      if (result !== null && result !== undefined) out.push(result)
    }
    return out
  }

  function serializeInlines(content: JSONContent[] | undefined): ComarkNode[] {
    if (!content) return []
    const out: ComarkNode[] = []
    for (const child of content) {
      if (!child.type) continue

      // Text gets wrapped by its marks. PM stores marks outer-first
      // (matches `DOMParser.fromSchema(...).parse()`'s convention; the
      // mark at index 0 is the outermost in the source DOM). To produce
      // `<strong><em>X</em></strong>` we must wrap with the LAST mark
      // first (innermost) and the FIRST mark last (outermost), hence the
      // reverse iteration. `parseInlines` prepends new marks for the
      // same reason — both directions agree on outer-first.
      if (child.type === TEXT_PM_NAME) {
        const text = child.text ?? ''
        if (text.length === 0) continue
        const marks = (child.marks ?? []) as PMMark[]
        let inner: ComarkNode = text
        for (let i = marks.length - 1; i >= 0; i--) {
          const m = marks[i]
          if (!m) continue
          const spec = markByPmName.get(m.type)
          if (!spec) continue
          inner = spec.toComark(m, inner)
        }
        out.push(inner)
        continue
      }

      // Inline atom (image, hardBreak, inline component) — the spec emits
      // its own Comark element. Marks on inline atoms wrap that element
      // outer-first, same convention as text-run marks.
      const spec = nodeByPmName.get(child.type)
      if (!spec) continue
      const result = spec.toComark(child, helpers)
      if (result === null || result === undefined) continue
      let wrapped: ComarkNode = result
      const atomMarks = (child.marks ?? []) as PMMark[]
      for (let i = atomMarks.length - 1; i >= 0; i--) {
        const m = atomMarks[i]
        if (!m) continue
        const ms = markByPmName.get(m.type)
        if (!ms) continue
        wrapped = ms.toComark(m, wrapped)
      }
      out.push(wrapped)
    }
    return out
  }

  // Comark → PM JSON

  function parseBlocks(children: ComarkNode[]): JSONContent[] {
    const out: JSONContent[] = []
    let inlineBuf: ComarkNode[] = []

    const flushInlines = () => {
      if (inlineBuf.length === 0) return
      const inlines = parseInlines(inlineBuf)
      if (inlines.length > 0) {
        out.push({ type: 'paragraph', content: inlines })
      }
      inlineBuf = []
    }

    for (const child of children) {
      if (isComarkText(child)) {
        // A bare text at block level — Comark's autoUnwrap omits the
        // paragraph wrapper when a container has a single paragraph child.
        // We bucket consecutive inlines together so they land in one
        // paragraph, not a paragraph each.
        if (child.length === 0) continue
        inlineBuf.push(child)
        continue
      }
      if (isComarkComment(child)) {
        flushInlines()
        const spec = nodeByPmName.get('comarkComment')
        if (spec) {
          const result = spec.fromComark(child as unknown as ComarkElement, helpers)
          if (result) out.push(result)
        }
        continue
      }
      if (!isComarkElement(child)) continue

      // Inline element (mark or inline-context node)? Buffer it.
      if (isInlineComarkElement(child)) {
        inlineBuf.push(child)
        continue
      }

      // Block element — flush whatever inlines we accumulated, then emit.
      flushInlines()
      const spec = pickNodeForTag(child)
      if (!spec) continue
      const result = spec.fromComark(child, helpers)
      if (result) out.push(result)
    }

    flushInlines()
    return out
  }

  function parseInlines(children: ComarkNode[]): JSONContent[] {
    const out: JSONContent[] = []
    for (const child of children) {
      if (isComarkText(child)) {
        if (child.length === 0) continue
        out.push({ type: 'text', text: child })
        continue
      }
      if (isComarkComment(child)) {
        // Comments inside inline runs are unusual; drop them silently.
        continue
      }
      if (!isComarkElement(child)) continue

      // Mark? Recurse into its children with the mark layered on.
      const markSpec = pickMarkForTag(child)
      if (markSpec) {
        const mark = markSpec.fromComark(child)
        if (!mark) continue
        const innerChildren = child.slice(2) as ComarkNode[]
        const innerJson = parseInlines(innerChildren)
        for (const j of innerJson) {
          // Prepend the new mark — at this point it's the OUTERMOST one
          // we've seen for this text run (we're unwinding the recursion
          // from the inside out). Outer-first ordering matches PM's
          // DOM-parser convention; `serializeInlines` wraps in reverse.
          const existing = (j.marks ?? []) as PMMark[]
          out.push({ ...j, marks: [mark, ...existing] })
        }
        continue
      }

      // Inline node (img, hardBreak, custom inline component)?
      const nodeSpec = pickNodeForTag(child)
      if (!nodeSpec) {
        // Unknown — splat the children as a last-resort lossy fallback so
        // the user at least sees the text. The kit covers everything
        // Comark emits, so this only fires for AST authored by hand with
        // unrecognized tags.
        const innerChildren = child.slice(2) as ComarkNode[]
        out.push(...parseInlines(innerChildren))
        continue
      }
      const json = nodeSpec.fromComark(child, helpers)
      if (json) out.push(json)
    }
    return out
  }

  const helpers: ComarkHelpers = {
    serializeBlocks,
    serializeInlines,
    parseBlocks,
    parseInlines,
    nodeSpecs: specs.nodes,
    markSpecs: specs.marks,
  }
  return helpers
}

// #region doc-level convenience

/**
 * Convert a PM doc JSON to a Comark tree using the given helpers.
 *
 * `frontmatter` and `meta` are caller-supplied — the editor doesn't own
 * them, so we just pass them through.
 */
export function pmDocToComark(
  doc: JSONContent,
  helpers: ComarkHelpers,
  carry: { frontmatter?: Record<string, unknown>; meta?: Record<string, unknown> } = {},
): ComarkTree {
  if (doc.type !== DOC_PM_NAME) {
    throw new Error(`Expected PM doc node, got "${doc.type}"`)
  }
  return {
    nodes: helpers.serializeBlocks(doc.content),
    frontmatter: { ...carry.frontmatter },
    meta: { ...carry.meta },
  }
}

/** Convert a Comark tree to a PM doc JSON using the given helpers. */
export function comarkToPmDoc(tree: ComarkTree, helpers: ComarkHelpers): JSONContent {
  const content = helpers.parseBlocks(tree.nodes)
  return {
    type: DOC_PM_NAME,
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  }
}

// #region Tiptap extension — wires the orchestrator to a live editor

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comark: {
      /**
       * Replace editor content from a Comark AST.
       *
       * Pass `{ emitUpdate: false }` for silent application — the new
       * content takes effect but no `update` event fires, so external
       * listeners aren't notified. Useful when the caller already holds
       * this value (e.g. for initial-content application) and an echo
       * back through `update` would clobber its source of truth.
       */
      setComarkAst: (tree: ComarkTree, options?: SetComarkContentOptions) => ReturnType
      /**
       * Replace editor content from a markdown string (parsed via comark).
       * Options have the same semantics as {@link setComarkAst}.
       */
      setComarkMarkdown: (markdown: string, options?: SetComarkContentOptions) => ReturnType
    }
  }
  interface Storage {
    comark: ComarkSerializerStorage
  }
  /**
   * `inline: true` tells `insertContent` / `insertContentAt` to flatten the
   * markdown's block structure — useful when the caller wants `**bold**`
   * inserted at the cursor as a bold text run, not a new paragraph. See
   * the override implementation for the exact extraction semantics.
   */
  interface InsertContentOptions {
    inline?: boolean
  }
  interface InsertContentAtOptions {
    inline?: boolean
  }
}

/**
 * Options accepted by {@link setComarkAst} and {@link setComarkMarkdown}.
 * The shape is a strict subset of Tiptap's `SetContentOptions`: only the
 * fields meaningful when the input is a Comark AST (or markdown that
 * parses to one) are forwarded. `parseOptions` is intentionally absent —
 * Comark inputs never reach Tiptap's HTML parser, so it has no effect.
 */
export interface SetComarkContentOptions {
  /**
   * Fire the editor's `update` event after replacing content.
   *
   * @default true
   */
  emitUpdate?: boolean

  /**
   * Throw on invalid content (relative to the active schema) instead of
   * silently coercing it. Mirrors Tiptap's option of the same name; when
   * omitted, the editor's `enableContentCheck` setting decides.
   */
  errorOnInvalidContent?: boolean
}

export interface ComarkSerializerStorage {
  /** The dispatch helpers built from the registered extensions. */
  helpers: ComarkHelpers | null
  /** External frontmatter / meta the editor doesn't own. */
  frontmatter: Record<string, unknown>
  meta: Record<string, unknown>
  /**
   * Editor instance, populated on `onCreate`. Internal — use `getAst` /
   * `getMarkdown` rather than reaching into this directly.
   */
  editor: Editor | null
  /** Read the editor's current content as a Comark AST. */
  getAst(): ComarkTree
  /** Read the editor's current content as Comark markdown. */
  getMarkdown(): Promise<string>
}

export interface ComarkSerializerOptions {
  /**
   * Auto-inject the kit's operational stylesheet (`comarkStyle`) into
   * `document.head` on editor creation. Mirrors `@tiptap/core`'s own
   * `injectCSS` option both in name shape and in dedup behavior — a
   * single `<style data-comark-style>` tag is shared across every
   * editor in the document.
   *
   * Set to `false` if a host (e.g. UI libraries) ships its own complete
   * stylesheet for the kit's markers, or if the consumer wants to
   * inject `comarkStyle` themselves with a CSP nonce / Shadow DOM /
   * scoped pipeline.
   *
   * @default true
   */
  injectStyles: boolean

  /**
   * CSP nonce applied to the auto-injected style tag. Mirrors Tiptap
   * core's `injectNonce`. Ignored when `injectStyles` is `false`.
   *
   * @default undefined
   */
  injectNonce?: string
}

export const ComarkSerializer = Extension.create<ComarkSerializerOptions, ComarkSerializerStorage>({
  name: 'comark',

  addOptions() {
    return {
      injectStyles: true,
      injectNonce: undefined,
    }
  },

  addStorage(): ComarkSerializerStorage {
    return {
      helpers: null,
      frontmatter: {},
      meta: {},
      editor: null,
      getAst(this: ComarkSerializerStorage): ComarkTree {
        if (!this.editor) throw new Error('[comark] editor not yet attached')
        const helpers = ensureHelpers(this.editor)
        return pmDocToComark(this.editor.getJSON() as JSONContent, helpers, {
          frontmatter: this.frontmatter,
          meta: this.meta,
        })
      },
      async getMarkdown(this: ComarkSerializerStorage): Promise<string> {
        const tree = this.getAst()
        return await renderMarkdown(tree)
      },
    }
  },

  onBeforeCreate() {
    // Stash the editor on storage as early as possible — `setComarkAst`
    // fired from a host's `onCreate` callback dispatches a transaction
    // before our extension's own `onCreate` would run, so we set up here.
    this.storage.editor = this.editor

    // Construction-time string content is markdown. Tiptap's constructor
    // calls `createDocument(options.content, ...)` directly (not via the
    // command system) at line 143 of Editor.ts — so the `setContent`
    // override in `addCommands` below never fires for the seed. Hijack
    // `options.content` here, BEFORE `createDoc` runs (this hook fires
    // at line 128 of Editor.ts), to keep markdown out of Tiptap's HTML
    // pipeline. Comark's parser is async, so we mount the editor with
    // empty content and re-apply the parsed AST when the parse resolves.
    // Same async semantics as `setComarkMarkdown` — callers see content
    // settle one microtask after construction, and the editor's `update`
    // event fires when it does.
    const opts = this.editor.options
    if (typeof opts.content === 'string' && opts.content !== '') {
      const markdown = opts.content
      // Mount empty; the parsed tree replaces it shortly.
      opts.content = ''
      parse(markdown)
        .then((tree) => {
          if (this.editor.isDestroyed) return
          this.editor.commands.setComarkAst(tree, { emitUpdate: true })
        })
        .catch((err) => {
          if (typeof console !== 'undefined') {
            console.warn('[comark] construction-time markdown parse failed:', err)
          }
        })
    }

    // Inject the operational stylesheet at the same point Tiptap core
    // injects its own (during construction, before any transaction).
    // `injectComarkStyles` is a no-op when `document` is undefined, so
    // this is safe in SSR / Node test runners.
    if (this.options.injectStyles) {
      injectComarkStyles(this.options.injectNonce)
    }
  },

  addCommands() {
    return {
      setComarkAst:
        (tree: ComarkTree, options?: SetComarkContentOptions) =>
        ({ commands }) => {
          const helpers = ensureHelpers(this.editor)
          this.storage.frontmatter = { ...tree.frontmatter }
          this.storage.meta = { ...tree.meta }
          const doc = comarkToPmDoc(tree, helpers)
          return commands.setContent(doc, {
            emitUpdate: options?.emitUpdate ?? true,
            errorOnInvalidContent: options?.errorOnInvalidContent,
          })
        },
      setComarkMarkdown:
        (markdown: string, options?: SetComarkContentOptions) =>
        ({ editor }) => {
          parse(markdown)
            .then((tree) => {
              if (editor.isDestroyed) return
              editor.commands.setComarkAst(tree, options)
            })
            .catch((err) => {
              if (typeof console !== 'undefined') {
                console.warn('[comark] setComarkMarkdown parse failed:', err)
              }
            })
          return true
        },

      // String-as-markdown overrides for Tiptap's core content commands.
      // The premise: `@comark/tiptap` is opinionated — strings ARE markdown,
      // never HTML. So `new Editor({ content: '# Hi' })`, `setContent('# Hi')`
      // and `insertContent('# Hi')` all route through the Comark parser
      // instead of Tiptap's HTML pipeline. Object inputs (PM JSON, Fragment,
      // ProseMirrorNode, null) and the empty string fall straight through to
      // the original commands, so callers passing pre-parsed content keep
      // the synchronous, byte-for-byte Tiptap behavior. Empty-string
      // fallthrough is deliberate: Tiptap's own `clearContent` uses
      // `setContent('', ...)` and relies on it being synchronous.
      //
      // Trade-off: comark.parse is async-only, so a string seed schedules
      // the actual content application a microtask later. The command
      // returns `true` optimistically; the editor's `update` event fires
      // when the parse resolves. Same semantics as `setComarkMarkdown`.
      setContent: (content, options) => (props) => {
        if (typeof content !== 'string' || content === '') {
          return baseSetContent(content as Content, options)(props)
        }
        parse(content)
          .then((tree) => {
            if (props.editor.isDestroyed) return
            props.editor.commands.setComarkAst(tree, {
              emitUpdate: options?.emitUpdate ?? true,
              errorOnInvalidContent: options?.errorOnInvalidContent,
            })
          })
          .catch((err) => {
            if (typeof console !== 'undefined') {
              console.warn('[comark] setContent: markdown parse failed:', err)
            }
          })
        return true
      },

      insertContent: (value, options) => (props) => {
        if (typeof value !== 'string' || value === '') {
          return baseInsertContent(value as Content, options)(props)
        }
        parse(value)
          .then((tree) => {
            if (props.editor.isDestroyed) return
            const helpers = ensureHelpers(props.editor)
            const doc = comarkToPmDoc(tree, helpers)
            const payload = options?.inline
              ? (extractInlines(doc) as Content)
              : ((doc.content ?? []) as Content)
            props.editor.commands.insertContent(payload, options)
          })
          .catch((err) => {
            if (typeof console !== 'undefined') {
              console.warn('[comark] insertContent: markdown parse failed:', err)
            }
          })
        return true
      },

      insertContentAt: (position, value, options) => (props) => {
        if (typeof value !== 'string' || value === '') {
          return baseInsertContentAt(position, value as Content, options)(props)
        }
        parse(value)
          .then((tree) => {
            if (props.editor.isDestroyed) return
            const helpers = ensureHelpers(props.editor)
            const doc = comarkToPmDoc(tree, helpers)
            const payload = options?.inline
              ? (extractInlines(doc) as Content)
              : ((doc.content ?? []) as Content)
            props.editor.commands.insertContentAt(position, payload, options)
          })
          .catch((err) => {
            if (typeof console !== 'undefined') {
              console.warn('[comark] insertContentAt: markdown parse failed:', err)
            }
          })
        return true
      },
    }
  },
})

/**
 * Look up every extension's `storage.comark` spec and build helpers from
 * them. Cached on the serializer's own storage so we only walk extensions
 * once per editor (until `recomputeHelpers` is called).
 */
function ensureHelpers(editor: Editor): ComarkHelpers {
  const storage = editor.storage.comark as ComarkSerializerStorage | undefined
  if (storage?.helpers) return storage.helpers
  const helpers = collectHelpers(editor.extensionManager.extensions)
  if (storage) storage.helpers = helpers
  return helpers
}

/**
 * Flatten a parsed PM doc to its inline children for `insertContent` /
 * `insertContentAt` when the caller passes `inline: true`.
 *
 * `comarkToPmDoc` always wraps content in blocks (paragraph / heading /
 * etc.) — that's what the schema demands at the doc root. For an inline
 * insert we don't want that wrapping; we want the *contents* of those
 * blocks, threaded together so they can be dropped at the cursor as a
 * text run with marks.
 *
 * Multi-block markdown gets stitched together with `hardBreak` between
 * blocks so paragraph boundaries from the source don't silently vanish
 * — `'a\n\nb'` becomes `a` + hardBreak + `b`, not `ab`. Single-paragraph
 * markdown (the common case for an inline insert: `'**bold**'`,
 * `'some _emphasized_ text'`) just unwraps to its inlines with no
 * boundary markers.
 */
function extractInlines(doc: JSONContent): JSONContent[] {
  const blocks = doc.content ?? []
  const out: JSONContent[] = []
  for (const block of blocks) {
    const inner = block?.content ?? []
    if (inner.length === 0) continue
    if (out.length > 0) out.push({ type: 'hardBreak' })
    out.push(...inner)
  }
  return out
}

/**
 * Pull `nodeSpec` / `markSpec` out of every extension's storage and feed
 * them to `createSerializer`.
 */
export function collectHelpers(extensions: readonly AnyExtension[]): ComarkHelpers {
  const nodes: NodeSpec[] = []
  const marks: MarkSpec[] = []
  for (const ext of extensions) {
    const spec = (ext.storage as { comark?: NodeSpec | MarkSpec } | undefined)?.comark
    if (!spec) continue
    if (ext.type === 'node') nodes.push(spec as NodeSpec)
    else if (ext.type === 'mark') marks.push(spec as MarkSpec)
  }
  return createSerializer({ nodes, marks })
}
