import { mergeAttrs, splitAttrs } from '../utils/attrs'
import type { ComarkElement, ComarkNode, MarkSpec, PMMark } from '../types'

// #region bold

export const boldSpec: MarkSpec = {
  pmName: 'bold',
  tags: ['strong', 'b'],

  toComark(mark: PMMark, child: ComarkNode): ComarkElement {
    const attrs = mergeAttrs(
      {},
      (mark.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return ['strong', attrs, child]
  },

  fromComark(el: ComarkElement): PMMark {
    const { htmlAttrs } = splitAttrs(el[1], [])
    return Object.keys(htmlAttrs).length > 0
      ? { type: 'bold', attrs: { htmlAttrs } }
      : { type: 'bold' }
  },
}

// #region italic

export const italicSpec: MarkSpec = {
  pmName: 'italic',
  tags: ['em', 'i'],

  toComark(mark: PMMark, child: ComarkNode): ComarkElement {
    const attrs = mergeAttrs(
      {},
      (mark.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return ['em', attrs, child]
  },

  fromComark(el: ComarkElement): PMMark {
    const { htmlAttrs } = splitAttrs(el[1], [])
    return Object.keys(htmlAttrs).length > 0
      ? { type: 'italic', attrs: { htmlAttrs } }
      : { type: 'italic' }
  },
}

// #region strike

export const strikeSpec: MarkSpec = {
  pmName: 'strike',
  // Comark canonicalises strikethrough to `<del>` on parse, so that's
  // what `fromComark` will see — but a hand-authored AST might use
  // `<s>` or `<strike>`, so we list those too as inputs.
  tags: ['del', 's', 'strike'],

  toComark(mark: PMMark, child: ComarkNode): ComarkElement {
    const attrs = mergeAttrs(
      {},
      (mark.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return ['del', attrs, child]
  },

  fromComark(el: ComarkElement): PMMark {
    const { htmlAttrs } = splitAttrs(el[1], [])
    return Object.keys(htmlAttrs).length > 0
      ? { type: 'strike', attrs: { htmlAttrs } }
      : { type: 'strike' }
  },
}

// #region code

export const codeSpec: MarkSpec = {
  pmName: 'code',
  tags: ['code'],

  toComark(mark: PMMark, child: ComarkNode): ComarkElement {
    const attrs = mergeAttrs(
      {},
      (mark.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return ['code', attrs, child]
  },

  fromComark(el: ComarkElement): PMMark {
    const { htmlAttrs } = splitAttrs(el[1], [])
    return Object.keys(htmlAttrs).length > 0
      ? { type: 'code', attrs: { htmlAttrs } }
      : { type: 'code' }
  },
}

// #region link
//
// Stock `@tiptap/extension-link` exposes href / title / target / rel /
// class as native PM attrs — we mirror that on both sides of the
// round-trip so adopting the upstream Link extension works without a
// schema fight. Anything else on the `<a>` element flows through
// `htmlAttrs` like every other mark.

const LINK_SEMANTIC = ['href', 'title', 'target', 'rel', 'class'] as const

export const linkSpec: MarkSpec = {
  pmName: 'link',
  tags: ['a'],

  toComark(mark: PMMark, child: ComarkNode): ComarkElement {
    const semantic: Record<string, unknown> = {
      href: (mark.attrs?.href as string | undefined) ?? '',
    }
    if (mark.attrs?.title != null && mark.attrs.title !== '') semantic.title = mark.attrs.title
    if (mark.attrs?.target != null && mark.attrs.target !== '') semantic.target = mark.attrs.target
    if (mark.attrs?.rel != null && mark.attrs.rel !== '') semantic.rel = mark.attrs.rel
    if (mark.attrs?.class != null && mark.attrs.class !== '') semantic.class = mark.attrs.class
    const attrs = mergeAttrs(
      semantic,
      (mark.attrs?.htmlAttrs as Record<string, unknown> | undefined) ?? {},
    )
    return ['a', attrs, child]
  },

  fromComark(el: ComarkElement): PMMark {
    const { semantic, htmlAttrs } = splitAttrs(el[1], LINK_SEMANTIC)
    const attrs: Record<string, unknown> = {
      href: (semantic.href as string | undefined) ?? '',
      title: (semantic.title as string | null | undefined) ?? null,
    }
    if (semantic.target != null) attrs.target = semantic.target
    if (semantic.rel != null) attrs.rel = semantic.rel
    if (semantic.class != null) attrs.class = semantic.class
    if (Object.keys(htmlAttrs).length > 0) attrs.htmlAttrs = htmlAttrs
    return { type: 'link', attrs }
  },
}
