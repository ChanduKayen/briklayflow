import { useEffect } from 'react'

interface ImageLightboxProps {
  url: string | null
  title?: string
  onClose: () => void
}

export function ImageLightbox({ url, title, onClose }: ImageLightboxProps) {
  useEffect(() => {
    if (!url) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [url, onClose])

  if (!url) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/20">
          <p className="text-[13px] font-semibold text-on-surface">{title || 'Image'}</p>
          <div className="flex items-center gap-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-on-surface-variant underline hover:text-primary"
              onClick={e => e.stopPropagation()}
            >
              Open full →
            </a>
            <button
              onClick={onClose}
              className="text-on-surface-variant hover:text-on-surface text-xl leading-none"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="p-4">
          <img
            src={url}
            alt={title || 'Image'}
            className="max-w-[80vw] max-h-[75vh] object-contain rounded-lg"
          />
        </div>
      </div>
    </div>
  )
}
