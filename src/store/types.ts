import type { JSONContent } from '@tiptap/core'

export type FontKey = 'sans' | 'serif' | 'mono'

// ---------------------------------------------------------------------------
// Spaced repetition
// ---------------------------------------------------------------------------

export type CardType = 'standard' | 'routine' | 'temp'

export interface RoutineConfig {
  /** Repeat every N units. */
  every: number
  unit: 'day' | 'week' | 'month'
  /** How the day's reviews are laid out. */
  mode: 'anytime' | 'times' | 'gaps'
  /** mode 'times': fixed times of day, 'HH:MM'. */
  times: string[]
  /** mode 'gaps': number of sessions per scheduled day… */
  count: number
  /** …spaced this many hours after the previous correct answer. */
  gapHours: number
}

export interface TempConfig {
  /** Correct answers wanted per day. */
  perDay: number
  /** Minimum minutes between reviews of this card (0 = immediately again). */
  gapMinutes: number
  /** Timestamp after which the card auto-archives. */
  until: number
}

/** Serialized ts-fsrs card state (dates as ISO strings). */
export interface FsrsState {
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: string
}

export interface CardRef {
  refId: string
  pageId: string
  /** Text as it was when highlighted — fallback if the live text is edited away. */
  snapshot: string
  createdAt: number
}

export interface SrsCard {
  id: string
  front: string
  back: string
  tags: string[]
  /** Deck = the page it was created from; null = unfiled. */
  pageId: string | null
  refs: CardRef[]
  type: CardType
  routine?: RoutineConfig
  temp?: TempConfig
  fsrs: FsrsState
  archived: boolean
  archivedAt?: number
  createdAt: number
  updatedAt: number
  /** Per-day progress for routine/temp scheduling (local date 'YYYY-MM-DD'). */
  day?: string
  daySlotsDone?: number
  lastCorrectAt?: number
  suspendedUntil?: number
}

export interface ReviewLogEntry {
  id: string
  cardId: string
  ts: number
  rating: 1 | 2 | 3 | 4
  elapsedMs: number
  cardType: CardType
  pageId: string | null
  /** FSRS snapshot after the review, for analytics. */
  stability: number
  difficulty: number
  /** Estimated recall probability the moment before this review. */
  retrievability: number
}

// ---------------------------------------------------------------------------
// Databases (Notion-style): a database is a Page carrying a `db` schema whose
// child pages are the rows. Schema lives once on the database; each row keeps
// only `props` (values keyed by field id). Presentation (order, widths,
// visibility, sorts, filters) lives per view, never on the field.
// ---------------------------------------------------------------------------

export type FieldType =
  | 'title'
  | 'text'
  | 'number'
  | 'select'
  | 'multiSelect'
  | 'date'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'createdTime'
  | 'updatedTime'

/** Notion's palette keys, styled to the alpine scheme in db.css. */
export type OptionColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'

export interface SelectOption {
  id: string
  name: string
  color: OptionColor
}

export type NumberFormat = 'plain' | 'commas' | 'percent' | 'currency'

export interface FieldConfig {
  options?: SelectOption[]
  numberFormat?: NumberFormat
}

export interface Field {
  id: string
  name: string
  type: FieldType
  config: FieldConfig
}

export interface DateValue {
  /** ISO date `YYYY-MM-DD`, with `THH:MM` when includeTime. */
  start: string
  end?: string
  includeTime?: boolean
}

/** select → option id; multiSelect → option ids; date → DateValue. */
export type CellValue = string | number | boolean | string[] | DateValue | null

export type FilterOp =
  | 'eq' | 'neq' | 'contains' | 'notContains' | 'startsWith' | 'endsWith'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'
  | 'empty' | 'notEmpty'

export interface FilterCond {
  fieldId: string
  op: FilterOp
  value?: CellValue
}

export interface FilterNode {
  conjunction: 'and' | 'or'
  children: (FilterNode | FilterCond)[]
}

export type CalcKey =
  | 'none'
  | 'countAll' | 'countValues' | 'countUnique' | 'countEmpty' | 'countNotEmpty'
  | 'percentEmpty' | 'percentNotEmpty'
  | 'sum' | 'avg' | 'median' | 'min' | 'max' | 'range'
  | 'earliest' | 'latest' | 'dateRange'
  | 'checked' | 'unchecked' | 'percentChecked' | 'percentUnchecked'

export interface ColumnMeta {
  width?: number
  hidden?: boolean
  wrap?: boolean
  calc?: CalcKey
}

export interface TableView {
  id: string
  name: string
  type: 'table'
  filter: FilterNode | null
  sorts: { fieldId: string; dir: 'asc' | 'desc' }[]
  /** Column order; fields missing here render at the end (newly added). */
  fieldOrder: string[]
  columnMeta: Record<string, ColumnMeta>
}

export interface DatabaseDef {
  fields: Field[]
  views: TableView[]
}

export interface Page {
  id: string
  title: string
  /** Emoji icon, or null for the default document glyph. */
  icon: string | null
  /** Key into COVERS, or null for no cover. */
  cover: string | null
  parentId: string | null
  /** Position among siblings; normalized to 0..n on every reorder. */
  order: number
  font: FontKey
  content: JSONContent | null
  /** Set when this page IS a database; its child pages are the rows. */
  db?: DatabaseDef
  /** Row property values keyed by field id (pages whose parent is a database). */
  props?: Record<string, CellValue>
  createdAt: number
  updatedAt: number
}
