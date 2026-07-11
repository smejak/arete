# Table databases for Arete — research + integration plan

*2026-07-10. Research distilled from Notion's API reference (2025-09-03 data-source model), Notion help docs, and the database implementations of AppFlowy, Teable, AFFiNE, Grist, Baserow, and NocoDB.*

## How Notion models databases

- **Database → data source → pages.** A database is a container; its *data source* holds the
  column schema (`properties`); **every row is a full page** — property values plus its own
  block content. The title property *is* the page title.
- **Schema on the source, values on the row.** A field is defined once
  (`{id, name, type, config}`, addressed by stable id — names are renamable); each row stores
  only `{fieldId → value}`.
- **Views own presentation.** Filters, sorts, grouping, column order/width/visibility, wrap,
  frozen column, and footer calculations are all **per view**, never on the schema. Filters are
  a recursive and/or tree; sorts are an ordered list (first wins). Every clone studied
  (AppFlowy, Teable, AFFiNE…) converges on this exact split.
- **Type changes are migrations.** Clones keep a per-(from→to) coercion table
  (text↔number, select↔text via option names, anything→text) and run it over existing cells;
  AppFlowy retains the old config so switching back is lossless.
- **Table-view UX essentials.** `+ New` row at the bottom; `+` column at the right header edge;
  hover a row → left checkbox, `⋮⋮` drag handle, `OPEN` on the title cell (opens the row as a
  page); column header menu = rename / change type / sort / filter / hide / wrap / insert
  left-right / duplicate / delete / calculate; column resize by dragging header edges; footer
  calculation per column (count·unique·empty·%, sum·avg·median·min·max·range, earliest/latest,
  checked/unchecked·%); select options carry a 10-color palette and are creatable inline from
  the cell editor; manual row order is disabled while a sort is active.
- **Filter operators by type** (the set worth implementing): text-family
  `equals/contains/starts/ends/empty`; number `=/≠/</>/≤/≥/empty`; checkbox `=/≠`; select
  `=/≠/empty`; multi-select `contains/empty`; date `is/before/after/on-or-before/on-or-after/
  empty` + relative (`past week/month/year, this/next week…`).

## Mapping onto Arete

The lucky break: **Arete pages already are Notion pages** (tree via `parentId`, TipTap content,
history, search, vault sync). So rows should simply *be* pages.

| Notion | Arete |
|---|---|
| Database + data source | a `Page` with a new `db?: DatabaseDef` field (the "database page") |
| Row | child page of the database page (`parentId = dbPageId`); new `props?: Record<fieldId, CellValue>` |
| Title property | `page.title` (no duplicate storage) |
| Created/edited time props | `page.createdAt` / `page.updatedAt` |
| Inline database block | new TipTap atom node `databaseBlock { pageId, owner }` — same owner-deletion semantics as `pageLink` (extend `scanOwnedPages`) |
| Full-page database | opening the db page: `PageView` sees `page.db` and renders the table instead of the editor |
| Open row as page | existing `openPage(rowId)`; row pages render a **properties panel** (parent has `db`) above the editor |
| Linked view (later) | `databaseBlock` with `owner: false` pointing at an existing db page |

What this buys for free: rows searchable (⌘K), row content history, share/export zips,
duplicate-page clones the whole database, sidebar nesting, vault files per row.

### Types (`store/types.ts` or new `store/db.ts`)

```ts
type FieldType = 'title'|'text'|'number'|'select'|'multiSelect'|'date'
               | 'checkbox'|'url'|'email'|'phone'|'createdTime'|'updatedTime'
interface SelectOption { id: string; name: string; color: string }   // alpine palette keys
interface Field { id: string; name: string; type: FieldType;
                  config: { options?: SelectOption[]; numberFormat?: 'plain'|'commas'|'percent'|'currency' } }
type CellValue = string | number | boolean | string[]                // + date: {start,end?,includeTime?}
type FilterNode = { conjunction: 'and'|'or'; children: (FilterNode|FilterCond)[] }
interface FilterCond { fieldId: string; op: string; value?: unknown }
interface TableView { id: string; name: string; type: 'table';
                      filter: FilterNode | null;
                      sorts: { fieldId: string; dir: 'asc'|'desc' }[];
                      fieldOrder: string[];
                      columnMeta: Record<string, { width?: number; hidden?: boolean;
                                                   wrap?: boolean; calc?: string }> }
interface DatabaseDef { fields: Field[]; views: TableView[] }
```

Pure helpers in `lib/db.ts`: filter-tree evaluator, multi-level comparator, footer
calculations, the type-coercion table, cell (de)serializers.

### Store actions (main store — rows are pages)

`createDatabase`, `addField/updateField/changeFieldType/removeField/moveField`,
`addRow` (createPage `navigate:false` + props), `setCell`, `deleteRows`, `duplicateRow`,
`moveRow`, `updateView` (sorts/filter/columnMeta/fieldOrder patches). Most are one-line
`patch(dbPageId, …)` / row patches, so undo-free zustand semantics stay consistent.

### UI (new `components/db/`, styles in `styles/db.css`)

`DatabaseTable` (header/body/footer grid, sticky header, `+ New` row, `+` column button),
per-type cell editors (`cells/`), `FieldMenu` (header dropdown incl. type picker + option
editor), `FilterMenu`, `SortMenu`, `CalcMenu`, `RowPageProps` (properties panel on row pages),
toolbar (view name · Filter · Sort · ⋯). Inside the editor it mounts via a
`NodeViewWrapper contentEditable={false}` — same component as full-page.

Design language: hairline `var(--border)` grid, 14px cells, spruce accent for interactive
chrome, alpenglow wash **only** for row selection, option chips in muted alpine tints.

### Vault round-trip (`lib/markdown.ts` / `lib/vault.ts`)

- DB page frontmatter gains one line: `arete-db: {json of DatabaseDef}`.
- Row page frontmatter gains: `arete-props: {json}` (exact round-trip; the existing
  frontmatter parser already handles `key: value` lines).
- Rows live as files in the db page's folder — existing hierarchy sync handles them.
- Follow-up: upgrade the Notion-export CSV importer to build a real database instead
  of a bullet list.

## Phases

1. **Core table** — schema/types/store, `/table` slash command + `databaseBlock`, full-page +
   inline rendering, the 12 field types above, cell editors, column add/rename/retype (with
   coercion)/delete/resize/reorder/hide, row add/delete/duplicate/drag-reorder, `OPEN` →
   row page with properties panel, vault round-trip.
2. **View power** — filter tree UI, multi-sort UI, footer calculations, wrap, row multi-select
   + bulk bar, keyboard grid navigation, frozen title column.
3. **Parity extras** — status-with-groups, grouping, templates, linked views, CSV import
   upgrade; later: board/calendar/gallery over the same view model; formula/relation/rollup
   (schema already leaves the seam: `config` can carry `expression` / relation target).

Deliberately deferred: person/people (single-user app), file attachments (no store yet),
real-time formula engine.
