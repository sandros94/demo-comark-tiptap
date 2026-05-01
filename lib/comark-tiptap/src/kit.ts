import { Extension, type Extensions } from '@tiptap/core'
import { Image, type ImageOptions } from '@tiptap/extension-image'
import { TableKit, type TableKitOptions } from '@tiptap/extension-table'
import { StarterKit, type StarterKitOptions } from '@tiptap/starter-kit'
import { ComarkAttrs } from './attrs'
import { ComarkCodeBlock } from './extensions/code-block'
import { ComarkComment } from './extensions/comment'
import { type ComarkComponentExports, defineComarkComponent } from './extensions/component'
import { ComarkTemplate } from './extensions/template'
import { ComarkSerializer, type ComarkSerializerOptions } from './serializer'
import { comarkSpecs } from './specs'

export interface ComarkKitOptions {
  /**
   * Forwarded to `StarterKit.configure(...)`. Use this to disable or
   * tweak individual stock extensions (`{ heading: false }`,
   * `{ heading: { levels: [1, 2, 3] } }`, etc.).
   *
   * The kit overrides two of StarterKit's defaults regardless of what
   * you pass here:
   *
   *   - `codeBlock: false` — replaced with `ComarkCodeBlock`, which
   *      adds Comark-specific attrs (filename / highlights / meta /
   *      codeHtmlAttrs) on top of the stock CodeBlock.
   *   - `underline: false` — Comark has no underline mark. Re-enable
   *      explicitly if your use case needs it (it will round-trip
   *      through htmlAttrs).
   */
  starterKit: Partial<StarterKitOptions> | false

  /** Forwarded to `TableKit.configure(...)`. Pass `false` to omit tables entirely. */
  table: Partial<TableKitOptions> | false

  /** Forwarded to `Image.configure(...)`. Pass `false` to omit images entirely. */
  image: Partial<ImageOptions> | false

  /**
   * User-defined Comark components from `defineComarkComponent`. Each
   * entry contributes a Tiptap node extension and a serialization spec.
   */
  components: ReadonlyArray<ComarkComponentExports>

  /**
   * Forwarded to `ComarkSerializer.configure(...)`. The kit always
   * supplies `specs` itself (built from the stock spec set + any
   * `components`), so only `injectStyles` / `injectNonce` are exposed
   * here.
   */
  serializer: Pick<ComarkSerializerOptions, 'injectStyles' | 'injectNonce'>

  /**
   * Disable / replace the comment extension (`<!-- … -->`). Pass
   * `false` to omit it from the schema; comment AST nodes that arrive
   * via `setComarkAst` will then be dropped silently.
   */
  comment: false | Record<string, never>

  /** Disable / replace the template extension (`::template[name]`). */
  template: false | Record<string, never>
}

/**
 * `ComarkKit` is a single Tiptap extension that, on `addExtensions`,
 * pulls in StarterKit, the Table cluster, Image, the comark-specific
 * nodes, the global `htmlAttrs` declaration, the serializer, and any
 * user-defined components.
 *
 * The pattern intentionally mirrors `StarterKit` (and `TableKit`) so
 * consumers familiar with Tiptap's vocabulary find their way without
 * surprises:
 *
 * ```ts
 * import { ComarkKit, defineComarkComponent } from '@comark/tiptap'
 *
 * const Alert = defineComarkComponent({ name: 'alert', kind: 'block' })
 *
 * new Editor({
 *   extensions: [
 *     ComarkKit.configure({ components: [Alert] }),
 *   ],
 *   content: '# Hi', // markdown — async parse
 * })
 * ```
 */
export const ComarkKit = Extension.create<ComarkKitOptions>({
  name: 'comarkKit',

  addOptions(): ComarkKitOptions {
    return {
      starterKit: {},
      table: {},
      image: {},
      components: [],
      serializer: { injectStyles: true, injectNonce: undefined },
      comment: {},
      template: {},
    }
  },

  addExtensions(): Extensions {
    const exts: Extensions = []

    // StarterKit: we override `codeBlock`, `link`, and `underline`
    // regardless of consumer config — see the option doc on
    // `starterKit` for the rationale. The user's config is layered on
    // top so they can re-enable / further tweak any of them.
    if (this.options.starterKit !== false) {
      exts.push(
        StarterKit.configure({
          codeBlock: false,
          underline: false,
          ...this.options.starterKit,
        }),
      )
    }

    // Comark-extended CodeBlock — adds filename / highlights / meta /
    // codeHtmlAttrs on top of the stock extension's behavior. Disable
    // by passing `starterKit: { codeBlock: false }` AND skipping this:
    // there's no separate option because we always need the comark
    // attrs to round-trip. If a consumer passed `codeBlock: false` to
    // StarterKit explicitly, we still install ComarkCodeBlock — to
    // truly remove code blocks, set `starterKit: false` and assemble
    // the extensions yourself.
    exts.push(ComarkCodeBlock)

    if (this.options.table !== false) {
      exts.push(TableKit.configure(this.options.table))
    }
    if (this.options.image !== false) {
      // Comark images live inline (`![alt](src)` always lands inside
      // a paragraph), so default to inline mode regardless of the
      // user-supplied options. Override explicitly if you need block
      // images.
      exts.push(Image.configure({ inline: true, ...this.options.image }))
    }
    if (this.options.comment !== false) {
      exts.push(ComarkComment)
    }
    if (this.options.template !== false) {
      exts.push(ComarkTemplate)
    }

    // Global `htmlAttrs` for every stock node and mark.
    exts.push(ComarkAttrs)

    // User-defined components — each contributes both a Tiptap node
    // extension (added here so the schema knows about it) and a
    // serialization spec (collected below for `ComarkSerializer`).
    for (const c of this.options.components) {
      exts.push(c.extension)
    }

    // The serializer goes last so it sees every contributed extension.
    // Its `specs` option carries the canonical comark dispatch table,
    // built from the stock spec set plus every component's spec.
    exts.push(
      ComarkSerializer.configure({
        specs: {
          nodes: [...comarkSpecs.nodes, ...this.options.components.map((c) => c.spec)],
          marks: comarkSpecs.marks,
        },
        injectStyles: this.options.serializer?.injectStyles ?? true,
        injectNonce: this.options.serializer?.injectNonce,
      }),
    )

    return exts
  },
})

/**
 * Re-export for callers that want to assemble extensions directly
 * without going through `ComarkKit` (e.g. unit tests).
 */
export { defineComarkComponent }
