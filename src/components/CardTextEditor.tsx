import { useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildCardExtensions } from '../editor/extensions'
import type { SlashItem } from '../editor/SlashCommand'
import { docToMarkdown, markdownToDoc } from '../lib/markdown'
import { cx } from '../lib/util'
import { SlashMenu, useSuggestionMenu } from './SlashMenu'

const noLinks = () => null

/**
 * A full Arete editor for card fields: live markdown, instant KaTeX, and the
 * complete "/" block palette (images, HTML embeds, callouts, toggles…) minus
 * page-only blocks. Values stay plain markdown strings, so cards remain
 * searchable, diffable in history, and readable in vault files.
 */
export function CardTextEditor({
  value,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  value: string
  onChange: (markdown: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const [slashView, slashSuggestion] = useSuggestionMenu<SlashItem>()
  const extensions = useMemo(
    () => buildCardExtensions(placeholder, { slash: slashSuggestion }),
    [placeholder, slashSuggestion],
  )
  const initial = useRef(markdownToDoc(value, noLinks).content).current

  const editor = useEditor({
    extensions,
    content: initial,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor }) => {
      onChangeRef.current(docToMarkdown(editor.getJSON(), noLinks).trimEnd())
    },
  })

  return (
    <div className="card-editor">
      <EditorContent editor={editor} />
      {slashView && <SlashMenu view={slashView} />}
    </div>
  )
}

/** Read-only renderer for a card side (review screen, previews). */
export function CardSide({ markdown, className }: { markdown: string; className?: string }) {
  const editor = useEditor(
    {
      extensions: buildCardExtensions(''),
      content: markdownToDoc(markdown, noLinks).content,
      editable: false,
    },
    [markdown],
  )
  return (
    <div className={cx('card-side', className)}>
      <EditorContent editor={editor} />
    </div>
  )
}
