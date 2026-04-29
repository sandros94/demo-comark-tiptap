import { hasNoHtmlAttrs } from './attrs'
import type { ComarkHelpers, ComarkNode, JSONContent } from '../types'

export function autoUnwrapBlocks(
  content: JSONContent[] | undefined,
  h: ComarkHelpers,
): ComarkNode[] {
  const list = content ?? []
  // Note: `hasNoHtmlAttrs` treats a `{}` bag the same as a missing one.
  // PM's parseHTML default fills `htmlAttrs: {}` on every paragraph that
  // came in via DOM, so a strict `!attrs?.htmlAttrs` check would refuse
  // to autoUnwrap any DOM-roundtripped paragraph.
  if (list.length === 1 && list[0]?.type === 'paragraph' && hasNoHtmlAttrs(list[0])) {
    return h.serializeInlines(list[0]?.content)
  }
  return h.serializeBlocks(list)
}
