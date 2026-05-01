import type { Attributes } from '@tiptap/core'

/**
 * Internal DOM attributes that PM/Tiptap manages itself, plus namespace
 * prefixes the kit uses for its own discriminator/payload attributes.
 *
 * `data-comark-` is reserved for the kit (e.g. `data-comark-comment`,
 * `data-comark-template`, `data-comark-component`): these attributes
 * carry payload or act as parseHTML matchers, and harvesting them into
 * `htmlAttrs` would (a) duplicate the value into a field that re-renders
 * separately and (b) "leak" the marker into the AST on round-trip.
 */
const PM_INTERNAL_ATTR_PREFIXES = [
  'data-pm-',
  'data-prosemirror-',
  'pm-',
  'data-node-view-',
  'data-comark-',
] as const

const PM_INTERNAL_ATTR_NAMES = new Set(['contenteditable', 'draggable', 'spellcheck'])

function isInternalAttr(name: string): boolean {
  if (PM_INTERNAL_ATTR_NAMES.has(name)) return true
  for (const prefix of PM_INTERNAL_ATTR_PREFIXES) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

export interface HtmlAttrSpecOptions {
  /**
   * Attributes the type already exposes natively (e.g. `level` on a
   * heading, `start` on an ordered list, `colspan` on a cell). These are
   * excluded from the `htmlAttrs` bag so a single value never lives in
   * two places.
   */
  reserved?: readonly string[]
}

/**
 * Returns a Tiptap `addAttributes()` fragment containing a single
 * `htmlAttrs` attribute. Used by:
 *
 *   1. `ComarkAttrs.addGlobalAttributes` — to attach `htmlAttrs` to every
 *      stock node/mark in one place (paragraph, heading, blockquote, …).
 *   2. `defineComarkComponent` — to attach `htmlAttrs` to user-defined
 *      block / inline components, since those names aren't known when the
 *      global config is built.
 */
export function htmlAttrSpec(options: HtmlAttrSpecOptions = {}): Attributes {
  const reserved = new Set(options.reserved ?? [])
  return {
    htmlAttrs: {
      // Default to an empty record so consumers can read `htmlAttrs` as
      // `Record<string, unknown>` without a null check. `renderHTML`
      // stringifies primitives; non-primitives are dropped to avoid
      // emitting `[object Object]` as an HTML attribute.
      default: {} as Record<string, unknown>,
      parseHTML: (el: HTMLElement) => {
        const out: Record<string, string> = {}
        for (const attr of Array.from(el.attributes)) {
          if (reserved.has(attr.name)) continue
          if (isInternalAttr(attr.name)) continue
          out[attr.name] = attr.value
        }
        return Object.keys(out).length > 0 ? out : null
      },
      renderHTML: (attrs: { htmlAttrs?: Record<string, unknown> | null }) => {
        const bag = attrs.htmlAttrs
        if (!bag || typeof bag !== 'object') return {}
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(bag)) {
          if (v === null || v === undefined) continue
          if (typeof v === 'string') {
            out[k] = v
          } else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
            out[k] = String(v)
          }
        }
        return out
      },
    },
  }
}
