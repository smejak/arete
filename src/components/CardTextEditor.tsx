import { useMemo, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { buildCardExtensions } from '../editor/extensions'
import { docToMarkdown, markdownToDoc } from '../lib/markdown'
import { cx } from '../lib/util'

const noLinks = () => null

/**
 * A pocket Arete editor for card fields: live markdown and instant KaTeX,
 * exactly like pages. Values stay plain markdown strings, so cards remain
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
  const extensions = useMemo(() => buildCardExtensions(placeholder), [placeholder])
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
