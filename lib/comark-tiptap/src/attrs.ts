import { Extension, type GlobalAttributes } from '@tiptap/core'
import { htmlAttrSpec } from './utils/html-attrs'

/**
 * Stock node/mark types whose semantic attrs already cover everything
 * relevant — the `htmlAttrs` bag for these picks up *every* HTML
 * attribute that isn't internal to PM/the kit. Splitting this list from
 * the reserved-key map below keeps maintenance simple: just add a name
 * here when StarterKit (or a comark-specific extension) ships a new node.
 */
const TYPES_NO_RESERVED = [
  // From StarterKit
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'listItem',
  'hardBreak',
  'horizontalRule',
  // Marks (from StarterKit)
  'bold',
  'italic',
  'strike',
  // Comark-specific
  'comarkComment',
] as const

/**
 * Reserved keys per type — attributes the type's own `addAttributes`
 * declares as native, so harvesting them into `htmlAttrs` would
 * duplicate their value into a second field.
 */
const RESERVED_BY_TYPE: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  // OrderedList exposes `start` (and `type` historically — Tiptap renders
  // a sequence kind, not an HTML attribute, but parseHTML reads it).
  [['orderedList'], ['start', 'type']],
  // Stock @tiptap/extension-link declares href / title / target / rel /
  // class as native attrs, so we reserve them all here. The link spec
  // round-trips them as native PM attrs (not via htmlAttrs).
  [['link'], ['href', 'title', 'target', 'rel', 'class']],
  // Code mark + code-block have semantic attrs we manage explicitly.
  [['code'], []],
  // CodeBlock's `language` lives on the inner `<code>`'s class, not on
  // the outer `<pre>` — so a `class` on the outer `<pre>` is free to
  // flow through htmlAttrs. We only reserve `language` (the extension's
  // own native attr).
  [['codeBlock'], ['language']],
  // Image exposes src / alt / title / width / height as native attrs.
  [['image'], ['src', 'alt', 'title', 'width', 'height']],
  // Table cells and headers expose colspan / rowspan / colwidth / align.
  [
    ['tableCell', 'tableHeader'],
    ['colspan', 'rowspan', 'colwidth', 'align'],
  ],
  // Stock `@tiptap/extension-table`'s renderHTML auto-injects a `style`
  // attribute (`min-width: …` or `width: …`) computed from the column
  // count. Reserving `style` here keeps it out of `htmlAttrs` so a DOM
  // round-trip doesn't end up with a Tiptap-computed value baked into
  // the AST. Trade-off: user-authored `style` on a `<table>` is lost,
  // which markdown tables almost never have, as it is a final UI
  // concern rather than editing semantics.
  [['table'], ['style']],
  [['tableRow'], []],
  // ComarkTemplate exposes `name` (slot name) as a native attr.
  [['comarkTemplate'], ['name']],
]

/**
 * Adds `htmlAttrs` as a global attribute to every stock node and mark
 * Comark cares about. Replaces the per-extension `...htmlAttrSpec(...)`
 * spread we used in the previous draft — one declaration here, applied
 * everywhere.
 *
 * User-defined components (via `defineComarkComponent`) declare their
 * own `htmlAttrs` in their `addAttributes` because their type names
 * aren't known at the time global attrs are resolved.
 */
export const ComarkAttrs = Extension.create({
  name: 'comarkAttrs',

  addGlobalAttributes(): GlobalAttributes {
    const groups: GlobalAttributes = [
      // No reserved keys — every HTML attr (other than PM/kit internal
      // ones) lands in htmlAttrs.
      {
        types: [...TYPES_NO_RESERVED],
        attributes: { ...htmlAttrSpec() },
      },
    ]
    for (const [types, reserved] of RESERVED_BY_TYPE) {
      groups.push({
        types: [...types],
        attributes: { ...htmlAttrSpec({ reserved }) },
      })
    }
    return groups
  },
})
