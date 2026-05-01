import {
  Extension,
  commands as tiptapCommands,
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
 * Build the recursion helpers from a flat list of node / mark specs.
 * Pure function — call once and reuse the helpers.
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
   * Inline-context Comark element? True for marks (always inline) and
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
      // `<strong><em>X</em></strong>` we wrap with the LAST mark first
      // (innermost) and the FIRST mark last (outermost), hence the
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

      // Inline atom (image, hardBreak, inline component) — the spec
      // emits its own Comark element. Marks on inline atoms wrap that
      // element outer-first, same convention as text-run marks.
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
        // paragraph wrapper when a container has a single paragraph
        // child. We bucket consecutive inlines together so they land in
        // one paragraph, not a paragraph each.
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
        // Unknown — splat the children as a last-resort lossy fallback
        // so the user at least sees the text. The kit covers everything
        // Comark emits; this only fires for AST authored by hand with
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
 * them, so we pass them through.
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
       * Replace editor content from a markdown string (parsed via
       * comark). Options have the same semantics as {@link setComarkAst}.
       */
      setComarkMarkdown: (markdown: string, options?: SetComarkContentOptions) => ReturnType
    }
  }
  interface Storage {
    comark: ComarkSerializerStorage
  }
  /**
   * `inline: true` tells `insertContent` / `insertContentAt` to flatten
   * a markdown string's block structure — useful when the caller wants
   * `**bold**` inserted at the cursor as a bold text run, not a new
   * paragraph. See the override implementation for the extraction
   * semantics.
   *
   * `contentType` is the escape hatch for the "strings-are-markdown"
   * default. Effective only for `string` input:
   *
   *   - `'markdown'` (default) — `comark.parse`, async.
   *   - `'html'`               — Tiptap's stock HTML pipeline, sync.
   *   - `'json'`               — `JSON.parse` first, then route by
   *                              shape: `{ nodes: [...] }` is treated
   *                              as a Comark AST, anything else as PM
   *                              JSON.
   *
   * Object inputs are auto-detected: anything with a `nodes` array
   * property is routed through `setComarkAst`, everything else
   * (Fragment, ProseMirrorNode, plain PM JSON) flows to the stock
   * command. The `contentType` flag is ignored for object inputs.
   */
  interface InsertContentOptions {
    inline?: boolean
    contentType?: 'markdown' | 'html' | 'json'
  }
  interface InsertContentAtOptions {
    inline?: boolean
    contentType?: 'markdown' | 'html' | 'json'
  }
  interface SetContentOptions {
    contentType?: 'markdown' | 'html' | 'json'
  }
  interface EditorOptions {
    /**
     * Same escape hatch as on `setContent` — pass `'html'` or `'json'`
     * here when constructing the editor with a string `content` that
     * should bypass Comark's markdown parser. Defaults to `'markdown'`
     * so `new Editor({ content: '# Hi' })` does the comark parse.
     * Object `content` is auto-detected (Comark AST vs PM JSON) and
     * the flag is ignored.
     */
    contentType?: 'markdown' | 'html' | 'json'
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
  /** The dispatch helpers built from the registered specs. */
  helpers: ComarkHelpers
  /** External frontmatter / meta the editor doesn't own. */
  frontmatter: Record<string, unknown>
  meta: Record<string, unknown>
  /**
   * Editor instance, populated on `onBeforeCreate`. Internal — use
   * `getAst` / `getMarkdown` instead of reaching in directly.
   */
  editor: Editor | null
  /** Read the editor's current content as a Comark AST. */
  getAst(): ComarkTree
  /** Read the editor's current content as Comark markdown. */
  getMarkdown(): Promise<string>
}

export interface ComarkSerializerOptions {
  /**
   * The serialization specs the orchestrator dispatches on. `ComarkKit`
   * passes the stock specs plus any user-defined components here; direct
   * consumers can supply their own subset.
   */
  specs: SerializerSpecs

  /**
   * Auto-inject the kit's operational stylesheet (`comarkStyle`) into
   * `document.head` on editor creation. Mirrors `@tiptap/core`'s own
   * `injectCSS` option both in name shape and in dedup behavior — a
   * single `<style data-comark-style>` tag is shared across every
   * editor in the document.
   *
   * Set to `false` if a host (e.g. UI libraries) ships its own complete
   * stylesheet, or if the consumer wants to inject `comarkStyle`
   * themselves with a CSP nonce / Shadow DOM / scoped pipeline.
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

const EMPTY_HELPERS: ComarkHelpers = createSerializer({ nodes: [], marks: [] })

export const ComarkSerializer = Extension.create<ComarkSerializerOptions, ComarkSerializerStorage>({
  name: 'comark',

  addOptions() {
    return {
      specs: { nodes: [], marks: [] },
      injectStyles: true,
      injectNonce: undefined,
    }
  },

  addStorage(): ComarkSerializerStorage {
    return {
      helpers: EMPTY_HELPERS,
      frontmatter: {},
      meta: {},
      editor: null,
      getAst(this: ComarkSerializerStorage): ComarkTree {
        if (!this.editor) throw new Error('[comark] editor not yet attached')
        return pmDocToComark(this.editor.getJSON() as JSONContent, this.helpers, {
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
    this.storage.helpers = createSerializer(this.options.specs)

    // Construction-time content needs special handling: Tiptap's
    // constructor calls `createDocument(options.content, ...)` directly
    // (not via the command system), so the `setContent` override below
    // never fires for the seed. We hijack `options.content` here, BEFORE
    // `createDoc` runs, for cases the stock pipeline can't handle.
    //
    //   - `string` (default markdown) → `comark.parse` is async, so we
    //     mount empty and re-apply when the parse resolves; the editor
    //     `update` event fires at that point. Same async semantics as
    //     `setComarkMarkdown`.
    //   - `string` + `contentType: 'json'` → JSON.parse synchronously,
    //     route by shape (Comark AST vs PM JSON). Mount synchronously.
    //   - `object` shaped like a Comark tree → apply via `setComarkAst`
    //     synchronously (Tiptap can't construct from a `ComarkTree`).
    //   - everything else (HTML strings, PM JSON objects, Fragment,
    //     ProseMirrorNode, …) — leave `options.content` alone and let
    //     Tiptap's pipeline handle it.
    const opts = this.editor.options
    if (typeof opts.content === 'string' && opts.content !== '') {
      if (opts.contentType === 'html') {
        // Pass-through to Tiptap's HTML pipeline.
      } else if (opts.contentType === 'json') {
        const parsed = safeJsonParse(opts.content, 'construction-time content')
        if (parsed !== undefined) {
          opts.content = isComarkTreeLike(parsed) ? null : (parsed as typeof opts.content)
          if (isComarkTreeLike(parsed)) {
            const tree = parsed
            queueMicrotask(() => {
              if (this.editor.isDestroyed) return
              this.editor.commands.setComarkAst(tree, { emitUpdate: false })
            })
          }
        }
      } else {
        const markdown = opts.content
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
    } else if (isComarkTreeLike(opts.content)) {
      const tree = opts.content
      opts.content = null
      queueMicrotask(() => {
        if (this.editor.isDestroyed) return
        this.editor.commands.setComarkAst(tree, { emitUpdate: false })
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
          this.storage.frontmatter = { ...tree.frontmatter }
          this.storage.meta = { ...tree.meta }
          const doc = comarkToPmDoc(tree, this.storage.helpers)
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
      // The premise: `@comark/tiptap` is opinionated — strings default
      // to markdown. Object inputs are auto-detected: anything with a
      // `nodes` array is treated as a Comark AST and routed through
      // `setComarkAst`, otherwise it flows to the stock command (PM
      // JSON, Fragment, ProseMirrorNode, …). Empty-string fallthrough
      // is deliberate: `clearContent` uses `setContent('', ...)` and
      // relies on it being synchronous.
      //
      // Escape hatches via `{ contentType }` (string inputs only):
      //   - `'html'` — let Tiptap parse the string as HTML, sync.
      //   - `'json'` — `JSON.parse`, then route by shape (Comark AST vs
      //                PM JSON). Sync for PM JSON, sync for Comark AST.
      //
      // Trade-off on the markdown path: comark.parse is async-only, so
      // a string seed schedules the actual content application a
      // microtask later. The command returns `true` optimistically;
      // the editor's `update` event fires when the parse resolves.
      // Same semantics as `setComarkMarkdown`.
      setContent: (content, options) => (props) => {
        // Object input: auto-detect Comark AST, otherwise fall through.
        // We inline the AST-application here (instead of bouncing
        // through `editor.commands.setComarkAst`) so the work happens
        // within the current command's transaction — calling another
        // command from inside a `(props) =>` handler dispatches a
        // fresh transaction and ProseMirror rejects it as "mismatched."
        if (isComarkTreeLike(content)) {
          this.storage.frontmatter = { ...content.frontmatter }
          this.storage.meta = { ...content.meta }
          const doc = comarkToPmDoc(content, this.storage.helpers)
          return baseSetContent(doc as unknown as Content, options)(props)
        }
        if (typeof content !== 'string' || content === '' || options?.contentType === 'html') {
          return baseSetContent(content as Content, options)(props)
        }
        if (options?.contentType === 'json') {
          const parsed = safeJsonParse(content, 'setContent')
          if (parsed === undefined) return false
          if (isComarkTreeLike(parsed)) {
            this.storage.frontmatter = { ...parsed.frontmatter }
            this.storage.meta = { ...parsed.meta }
            const doc = comarkToPmDoc(parsed, this.storage.helpers)
            return baseSetContent(doc as unknown as Content, options)(props)
          }
          return baseSetContent(parsed as Content, options)(props)
        }
        parse(content)
          .then((tree) => {
            if (props.editor.isDestroyed) return
            // Async branch — outer transaction has settled, safe to
            // dispatch a fresh command.
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
        if (isComarkTreeLike(value)) {
          const payload = comarkTreeToInsertPayload(value, this.storage.helpers, options?.inline)
          return baseInsertContent(payload, options)(props)
        }
        if (typeof value !== 'string' || value === '' || options?.contentType === 'html') {
          return baseInsertContent(value as Content, options)(props)
        }
        if (options?.contentType === 'json') {
          const parsed = safeJsonParse(value, 'insertContent')
          if (parsed === undefined) return false
          if (isComarkTreeLike(parsed)) {
            const payload = comarkTreeToInsertPayload(parsed, this.storage.helpers, options?.inline)
            return baseInsertContent(payload, options)(props)
          }
          return baseInsertContent(parsed as Content, options)(props)
        }
        parse(value)
          .then((tree) => {
            if (props.editor.isDestroyed) return
            const payload = comarkTreeToInsertPayload(tree, this.storage.helpers, options?.inline)
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
        if (isComarkTreeLike(value)) {
          const payload = comarkTreeToInsertPayload(value, this.storage.helpers, options?.inline)
          return baseInsertContentAt(position, payload, options)(props)
        }
        if (typeof value !== 'string' || value === '' || options?.contentType === 'html') {
          return baseInsertContentAt(position, value as Content, options)(props)
        }
        if (options?.contentType === 'json') {
          const parsed = safeJsonParse(value, 'insertContentAt')
          if (parsed === undefined) return false
          if (isComarkTreeLike(parsed)) {
            const payload = comarkTreeToInsertPayload(parsed, this.storage.helpers, options?.inline)
            return baseInsertContentAt(position, payload, options)(props)
          }
          return baseInsertContentAt(position, parsed as Content, options)(props)
        }
        parse(value)
          .then((tree) => {
            if (props.editor.isDestroyed) return
            const payload = comarkTreeToInsertPayload(tree, this.storage.helpers, options?.inline)
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

// #region routing helpers (Comark AST detection + dispatch)

/** Object with a `nodes` array — the structural signature of a `ComarkTree`. */
function isComarkTreeLike(v: unknown): v is ComarkTree {
  return (
    !!v &&
    typeof v === 'object' &&
    'nodes' in (v as Record<string, unknown>) &&
    Array.isArray((v as { nodes: unknown }).nodes)
  )
}

function safeJsonParse(input: string, label: string): unknown {
  try {
    return JSON.parse(input)
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn(`[comark] ${label}: contentType="json" but content is not valid JSON:`, err)
    }
    return undefined
  }
}

/**
 * Turn a `ComarkTree` into the payload `insertContent` /
 * `insertContentAt` actually want — the doc's block content array, or
 * its inline-flattened form when `inline: true`. The doc-level wrap is
 * stripped because PM's `insert*` commands take a slice of nodes, not
 * a `doc` node.
 */
function comarkTreeToInsertPayload(
  tree: ComarkTree,
  helpers: ComarkHelpers,
  inline?: boolean,
): Content {
  const doc = comarkToPmDoc(tree, helpers)
  return inline ? (extractInlines(doc) as Content) : ((doc.content ?? []) as Content)
}

/**
 * Flatten a parsed PM doc to its inline children for `insertContent` /
 * `insertContentAt` when the caller passes `inline: true`.
 *
 * `comarkToPmDoc` always wraps content in blocks (paragraph / heading /
 * etc.) — that's what the schema demands at the doc root. For an inline
 * insert we don't want the wrapping; we want the *contents* of those
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
