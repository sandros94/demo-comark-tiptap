export type {
  ComarkComment as ComarkCommentTuple,
  ComarkElement,
  ComarkElementAttributes,
  ComarkHelpers,
  ComarkNode,
  ComarkText,
  ComarkTree,
  JSONContent,
  MarkSpec,
  NodeSpec,
  PMMark,
} from './types'

export {
  ComarkSerializer,
  collectHelpers,
  comarkToPmDoc,
  createSerializer,
  pmDocToComark,
  type ComarkSerializerOptions,
  type ComarkSerializerStorage,
  type SerializerSpecs,
  type SetComarkContentOptions,
} from './serializer'
export { attrsEqual, cleanAttrs, hasNoHtmlAttrs, mergeAttrs, splitAttrs } from './utils/attrs'
export { htmlAttrSpec, type HtmlAttrSpecOptions } from './utils/html-attrs'

export { COMARK_STYLE_MARKER, comarkStyle, injectComarkStyles } from './style'

export { ComarkKit, comarkSpecs } from './kit'

// #region nodes
export { ComarkBlockquote, blockquoteSpec } from './nodes/blockquote'
export { ComarkCodeBlock, codeBlockSpec } from './nodes/code-block'
export { ComarkComment, commentSpec } from './nodes/comment'
export { ComarkHardBreak, hardBreakSpec } from './nodes/hard-break'
export { ComarkHeading, headingSpec } from './nodes/heading'
export { ComarkHorizontalRule, horizontalRuleSpec } from './nodes/horizontal-rule'
export { ComarkImage, imageSpec } from './nodes/image'
export {
  ComarkBulletList,
  ComarkListItem,
  ComarkOrderedList,
  bulletListSpec,
  listItemSpec,
  orderedListSpec,
} from './nodes/lists'
export { ComarkParagraph, paragraphSpec } from './nodes/paragraph'
export {
  ComarkTable,
  ComarkTableCell,
  ComarkTableHeader,
  ComarkTableRow,
  tableCellSpec,
  tableHeaderSpec,
  tableRowSpec,
  tableSpec,
} from './nodes/table'
export { ComarkTemplate, templateSpec } from './nodes/template'

// #region marks
export { ComarkBold, boldSpec } from './marks/bold'
export { ComarkCode, codeSpec } from './marks/code'
export { ComarkItalic, italicSpec } from './marks/italic'
export { ComarkLink, linkSpec } from './marks/link'
export { ComarkStrike, strikeSpec } from './marks/strike'

// #region extensions
export {
  defineComarkComponent,
  type ComarkComponentDefinition,
  type ComarkComponentExports,
  type ComarkComponentProp,
} from './extensions/component'
