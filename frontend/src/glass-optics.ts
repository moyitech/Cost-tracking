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

// One continuous lens and four intact glyphs. The old sliced artwork duplicated
// the navigation eleven times and split small Chinese labels at the lens edge.
// Layout dimensions stay fixed; only transforms and opacity change per frame.
export function glassOptics(barWidth: number, barHeight: number, position: number, amount: number, velocity: number) {
  const strength = Math.max(0, Math.min(1, amount))
  const buttonWidth = Math.max(1, (barWidth - 14) / 4)
  const index = Math.max(0, Math.min(3, position))
  const speed = Math.min(1, Math.abs(velocity) / 10)
  const scaleX = 1 + (8 + 10 * speed) * strength / buttonWidth
  const scaleY = 1 + (6 - 2 * speed) * strength / 44
  const lift = -1.5 * strength
  const x = index * (buttonWidth + 2)
  const width = buttonWidth * scaleX
  const height = 44 * scaleY
  const items = Array.from({ length: 4 }, (_, tab) => {
    const distance = tab - index
    const proximity = Math.max(0, 1 - Math.abs(distance) / .85)
    const influence = proximity * proximity * (3 - 2 * proximity) * strength
    const scale = 1 + .12 * influence
    return { scale, transform: `translate3d(${(-distance * 2 * influence).toFixed(3)}px, ${(-1.25 * influence).toFixed(3)}px, 0) scale(${scale.toFixed(4)})` }
  })
  return {
    buttonWidth, width, height, strength, items, active: Math.round(index),
    left: 4 + x - (width - buttonWidth) / 2,
    top: (barHeight - height) / 2 + lift,
    transform: `translate3d(${x.toFixed(3)}px, ${lift.toFixed(3)}px, 0) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`,
  }
}
