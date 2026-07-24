import { lazy, Suspense, type ComponentType } from 'react'
import { FileText, type LucideProps } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'

/**
 * Page icons are stored as a single string: a bare emoji (as before), or a
 * Lucide icon encoded as "lucide:<kebab-name>". Emoji render as text; Lucide
 * names resolve to their SVG, lazy-loaded by name so the full ~1,500-icon set
 * is searchable without bundling all of it. Everything funnels through
 * `PageIcon` so every surface (sidebar, tabs, header, search…) agrees.
 */

const LUCIDE_PREFIX = 'lucide:'

const imports = dynamicIconImports as unknown as Record<
  string,
  () => Promise<{ default: ComponentType<LucideProps> }>
>

/** Every Lucide icon name (kebab-case), sorted — the picker's search corpus. */
export const lucideNames: string[] = Object.keys(imports).sort()

export const isLucideIcon = (icon?: string | null): icon is string =>
  !!icon && icon.startsWith(LUCIDE_PREFIX)

/** Storage value for a Lucide icon, e.g. lucideIcon('rocket') → "lucide:rocket". */
export const lucideIcon = (name: string) => LUCIDE_PREFIX + name

// React.lazy components must be stable across renders — cache one per name.
type IconComponent = ComponentType<LucideProps>
const cache = new Map<string, IconComponent>()
function resolve(name: string): IconComponent | null {
  const factory = imports[name]
  if (!factory) return null
  let c = cache.get(name)
  if (!c) {
    // lazy() returns a LazyExoticComponent; it renders as a component but its
    // ref typing differs from LucideProps, so bridge it explicitly.
    c = lazy(factory) as unknown as IconComponent
    cache.set(name, c)
  }
  return c
}

function LucideByName({
  name,
  size,
  strokeWidth,
}: {
  name: string
  size: number
  strokeWidth: number
}) {
  const C = resolve(name)
  if (!C) return <FileText size={size} strokeWidth={strokeWidth} />
  return (
    <Suspense fallback={<span style={{ display: 'inline-block', width: size, height: size }} />}>
      <C size={size} strokeWidth={strokeWidth} />
    </Suspense>
  )
}

/** Renders a page icon: an emoji as text, a "lucide:name" icon as its SVG, or a
 * file glyph when there is no icon. */
export function PageIcon({
  icon,
  size = 16,
  strokeWidth = 1.7,
}: {
  icon?: string | null
  size?: number
  strokeWidth?: number
}) {
  if (isLucideIcon(icon)) {
    return (
      <LucideByName name={icon.slice(LUCIDE_PREFIX.length)} size={size} strokeWidth={strokeWidth} />
    )
  }
  if (icon) return <>{icon}</>
  return <FileText size={size} strokeWidth={strokeWidth} />
}

/** Plain-text icon for string-only contexts (dropdown labels, HTML export):
 * emoji pass through; Lucide icons fall back to a neutral glyph. */
export function iconText(icon?: string | null, fallback = '📄'): string {
  if (!icon || isLucideIcon(icon)) return fallback
  return icon
}
