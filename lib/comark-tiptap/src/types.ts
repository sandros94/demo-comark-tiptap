import type { JSONContent } from '@tiptap/core'
import type {
  ComarkComment,
  ComarkElement,
  ComarkElementAttributes,
  ComarkNode,
  ComarkText,
  ComarkTree,
} from 'comark'

export type {
  ComarkComment,
  ComarkElement,
  ComarkElementAttributes,
  ComarkNode,
  ComarkText,
  ComarkTree,
  JSONContent,
}

/**
 * A PM mark in JSON form. Tiptap's `JSONContent` types `marks` as
 * `Record<string, any>[]` — we name a stricter shape here because the
 * serializer reads `type` and `attrs` everywhere.
 */
export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

/**
 * Per-node serialization spec. Stock specs (paragraph, heading, …) live in
 * `./specs/*` and ship with `comarkSpecs`; user-defined components emit
 * one of these from `defineComarkComponent`.
 *
 * The orchestrator (`createSerializer`) builds dispatch tables from a list
 * of these — there is no `addStorage` sidecar on the Tiptap extensions.
 */
export interface NodeSpec {
  /** PM type name (matches the Tiptap node's `name`). */
  pmName: string
  /**
   * Comark tag(s) this node claims. Heading claims `h1..h6`; paragraph
   * claims `p`; tables claim `table`/`tr`/`th`/`td`. Tag is matched on
   * `el[0]`. An empty list means the spec is dispatched by PM name only
   * (e.g. `comarkComment` is routed when `el[0] === null`).
   */
  tags: readonly string[]
  /**
   * Block-level structural element (default) or inline atom that can
   * appear inside a paragraph (`hardBreak`, `image`, registered inline
   * components). The orchestrator uses this to bucket Comark's
   * autoUnwrap-flattened inline runs back into paragraphs.
   *
   * @default 'block'
   */
  context?: 'block' | 'inline'
  /** PM JSON node → Comark element. */
  toComark: (node: JSONContent, h: ComarkHelpers) => ComarkNode | null
  /** Comark element → PM JSON node. */
  fromComark: (el: ComarkElement, h: ComarkHelpers) => JSONContent | null
  /**
   * Optional disambiguation when several specs share a tag. The first
   * spec whose `matches` returns true wins; without `matches`, the
   * registration order decides.
   */
  matches?: (el: ComarkElement) => boolean
}

/**
 * Per-mark serialization spec. Marks differ from nodes: the orchestrator
 * hands the already-serialized child node to `toComark` and asks the mark
 * to wrap it.
 */
export interface MarkSpec {
  pmName: string
  tags: readonly string[]
  /** Wrap an already-serialized child Comark node with this mark. */
  toComark: (mark: PMMark, child: ComarkNode) => ComarkElement
  /** Read attrs off a Comark element and turn them into a PM mark. */
  fromComark: (el: ComarkElement) => PMMark | null
}

/**
 * Recursion helpers passed into every `toComark` / `fromComark` so each
 * spec can defer back to the orchestrator for nested children.
 */
export interface ComarkHelpers {
  /** PM block-content children → Comark nodes. */
  serializeBlocks: (content: JSONContent[] | undefined) => ComarkNode[]
  /** PM inline-content children (text + marks + inline atoms) → Comark nodes. */
  serializeInlines: (content: JSONContent[] | undefined) => ComarkNode[]
  /** Comark children (block context) → PM JSON nodes. */
  parseBlocks: (children: ComarkNode[]) => JSONContent[]
  /** Comark children (inline context) → PM JSON nodes. */
  parseInlines: (children: ComarkNode[]) => JSONContent[]
  /** All node specs the orchestrator was built with. */
  nodeSpecs: readonly NodeSpec[]
  /** All mark specs the orchestrator was built with. */
  markSpecs: readonly MarkSpec[]
}
