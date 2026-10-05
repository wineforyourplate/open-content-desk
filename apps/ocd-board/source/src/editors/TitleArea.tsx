import { useEffect, useRef } from 'react'

/** A title field that WRAPS and auto-grows (never horizontal-scrolls). Same ResizeObserver
 *  height-fit as the tweet boxes, so it re-fits on the real width and on window resize. */
export function TitleArea({
  value, onChange, onCommit, placeholder, className, maxLength,
}: {
  value: string
  onChange: (v: string) => void
  onCommit?: () => void
  placeholder?: string
  className?: string
  maxLength?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let lastW = -1
    const fit = () => { if (!el.clientWidth) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
    const ro = new ResizeObserver((e) => { const w = e[0].contentRect.width; if (w !== lastW) { lastW = w; fit() } })
    ro.observe(el); fit()
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const el = ref.current
    if (el && el.clientWidth) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }, [value])
  return (
    <textarea
      ref={ref} className={className} value={value} placeholder={placeholder} rows={1} maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)} onBlur={onCommit}
      onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }}
    />
  )
}
