import { mergeAttrs, splitAttrs } from '../utils/attrs'
// The Comark *tuple* type is imported under an alias so we can name the
// Tiptap *extension* `ComarkComment` (in `extensions/comment.ts`) without
// a merged-declaration clash.
import type {
  ComarkComment as ComarkCommentTuple,
  ComarkElement,
  JSONContent,
  NodeSpec,
} from '../types'

const SEMANTIC_KEYS = ['text'] as const

export const commentSpec: NodeSpec = {
  pmName: 'comarkComment',
  // The orchestrator never matches `null` to a tag string — it
  // dispatches by detecting `el[0] === null` and looking up
  // `comarkComment` directly. An empty tag set keeps the dispatch table
  // clean.
  tags: [] as readonly string[],

  toComark(node: JSONContent): ComarkCommentTuple {
    const text = (node.attrs?.text as string | undefined) ?? ''
    const attrs = mergeAttrs(
      {},
      (node.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return [null, attrs, text]
  },

  fromComark(el: ComarkElement): JSONContent | null {
    // Cast to the comment shape — orchestrator only routes comments here.
    const comment = el as unknown as ComarkCommentTuple
    const text = comment[2] ?? ''
    const { htmlAttrs } = splitAttrs(comment[1], SEMANTIC_KEYS)
    const attrs: Record<string, unknown> = { text }
    if (Object.keys(htmlAttrs).length > 0) attrs.htmlAttrs = htmlAttrs
    return { type: 'comarkComment', attrs }
  },
}
