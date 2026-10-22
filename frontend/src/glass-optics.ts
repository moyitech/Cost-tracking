export interface SpringValue { value: number; velocity: number }

export function stepGlassSpring(state: SpringValue, target: number, seconds: number, stiffness = 650, damping = 38): SpringValue {
  const steps = Math.max(1, Math.ceil(Math.min(seconds, 1 / 30) * 120))
  const dt = Math.min(seconds, 1 / 30) / steps
  let { value, velocity } = state
  for (let i = 0; i < steps; i++) {
    velocity += ((target - value) * stiffness - velocity * damping) * dt
    value += velocity * dt
  }
  return { value, velocity }
}

// Piecewise optical sampling works in both a WebView and WeChat's view renderer.
// The center magnifies; the curved edges compress the same source artwork.
export function glassOptics(barWidth: number, barHeight: number, position: number, amount: number, velocity: number) {
  const strength = Math.max(0, Math.min(1, amount))
  const buttonWidth = (barWidth - 14) / 4
  const center = Math.max(0, Math.min(3, position)) * (buttonWidth + 2) + buttonWidth / 2
  const speed = Math.min(1, Math.abs(velocity) / 6)
  const width = buttonWidth + (12 + 18 * speed) * strength
  const height = 44 + (10 - 3 * speed) * strength
  const left = center - width / 2
  const top = (barHeight - 2 - height) / 2 - 2 * strength
  const curvature = Math.max(0, strength) * .36
  // Anchor the outer samples to the original artwork so no glyph is skipped
  // when the lens passes it. Magnification comes from the curved interior.
  const sample = (u: number) => center + (u + curvature * u ** 3) / (1 + curvature) * width / 2
  const edges = [-1, -.88, -.7, -.45, -.2, .2, .45, .7, .88, 1]
  const scaleY = 1 + Math.max(0, strength) * .16
  const bands = edges.slice(0, -1).map((u, index) => {
    const end = edges[index + 1]
    const outputLeft = (u + 1) * width / 2
    const outputWidth = (end - u) * width / 2
    const sourceLeft = sample(u)
    const sourceRight = sample(end)
    const scaleX = outputWidth / (sourceRight - sourceLeft)
    return { left: outputLeft, width: outputWidth, sourceLeft, sourceRight, scaleX, scaleY, x: -sourceLeft * scaleX, y: (height - 44 * scaleY) / 2 }
  })
  const trackWidth = barWidth - 8
  const artworkTop = (barHeight - 2 - 44) / 2
  const radius = height / 2
  const cutout = Array.from({ length: 23 }, (_, index) => {
    const y = index * 2
    const dy = y + artworkTop - top - radius
    const inset = radius - Math.sqrt(Math.max(0, radius ** 2 - dy ** 2))
    return { y, left: Math.max(0, Math.min(trackWidth, left + inset)), right: Math.max(0, Math.min(trackWidth, left + width - inset)) }
  })
  // The untouched artwork follows the capsule's curved silhouette, rather
  // than leaving rectangular gaps next to the clipped optical layer.
  const outsideLeft = `polygon(0px 0px, ${cutout.map(p => `${p.left}px ${p.y}px`).join(', ')}, 0px 44px)`
  const outsideRight = `polygon(${trackWidth}px 0px, ${cutout.map(p => `${p.right}px ${p.y}px`).join(', ')}, ${trackWidth}px 44px)`
  return { buttonWidth, trackWidth, width, height, left, top, strength, bands, cutout, outsideLeft, outsideRight }
}
