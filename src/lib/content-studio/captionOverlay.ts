/**
 * Draws a caption (text, emoji and all) to a transparent PNG the same size
 * as the video frame, so ffmpeg can composite it in with a plain `overlay`
 * filter instead of drawing the text itself.
 *
 * This exists because ffmpeg.wasm's drawtext filter uses freetype directly
 * against a single loaded font file — it has no color-emoji glyphs and no
 * fallback font, so any emoji in a caption just silently doesn't get drawn.
 * The browser's own Canvas 2D text renderer does not have that problem: it
 * uses the OS/browser font stack, which already resolves emoji to a real
 * color emoji font as a normal part of drawing text. Rendering the caption
 * here and handing ffmpeg a finished image sidesteps ffmpeg's font
 * limitation entirely rather than trying to work around it.
 */
export type CaptionPosition = 'top' | 'bottom' | 'left' | 'right' | 'center'

export type CaptionSize = 'sm' | 'md' | 'lg'

export interface CaptionImageInput {
  text: string
  position?: CaptionPosition
  size?: CaptionSize
}

const SIZE_SCALE: Record<CaptionSize, number> = { sm: 0.72, md: 1, lg: 1.35 }

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * A full-frame transparent PNG with the caption drawn at the right spot —
 * ffmpeg overlays it at (0,0), no positioning math needed on ffmpeg's side.
 * frameWidth/frameHeight must be the real video dimensions so the text and
 * margins land in the same place drawtext's expressions used to.
 */
export async function renderCaptionImage(
  caption: CaptionImageInput,
  frameWidth: number,
  frameHeight: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = frameWidth
  canvas.height = frameHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.')

  const text = caption.text.trim()
  // Scaled off the frame height so captions read a consistent size whether
  // the footage is 720p or 4K — same ratio drawtext's fixed fontsize=42 gave
  // on a roughly 1080-tall portrait clip. size then scales that baseline.
  const fontSize = Math.max(14, Math.round(frameHeight * 0.039 * SIZE_SCALE[caption.size ?? 'md']))
  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'middle'

  const maxTextWidth = frameWidth * 0.86
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width > maxTextWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)

  const lineHeight = fontSize * 1.3
  const textBlockWidth = Math.min(maxTextWidth, Math.max(...lines.map((l) => ctx.measureText(l).width)))
  const padX = fontSize * 0.5
  const padY = fontSize * 0.35
  const boxWidth = textBlockWidth + padX * 2
  const boxHeight = lineHeight * lines.length + padY * 2
  const margin = Math.round(frameHeight * 0.055)

  const position = caption.position ?? 'bottom'
  let boxX: number, boxY: number
  switch (position) {
    case 'top': boxX = (frameWidth - boxWidth) / 2; boxY = margin; break
    case 'left': boxX = margin; boxY = (frameHeight - boxHeight) / 2; break
    case 'right': boxX = frameWidth - boxWidth - margin; boxY = (frameHeight - boxHeight) / 2; break
    case 'center': boxX = (frameWidth - boxWidth) / 2; boxY = (frameHeight - boxHeight) / 2; break
    case 'bottom': default: boxX = (frameWidth - boxWidth) / 2; boxY = frameHeight - boxHeight - margin; break
  }

  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  roundRect(ctx, boxX, boxY, boxWidth, boxHeight, fontSize * 0.25)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => {
    const lineWidth = ctx.measureText(l).width
    const lx = boxX + (boxWidth - lineWidth) / 2
    const ly = boxY + padY + lineHeight * i + lineHeight / 2
    ctx.fillText(l, lx, ly)
  })

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not render the caption image.'))), 'image/png')
  })
}
