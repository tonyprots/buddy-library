const stageBounds = [0, 0, 1280, 720]
const channels = ['x', 'y', 'scale']
const valid = box => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite)
  && box[2] > box[0] && box[3] > box[1]

export function unionBounds(...boxes) {
  const visible = boxes.flatMap(box => valid(box) ? [box] : [])
  return visible.length ? [Math.min(...visible.map(box => box[0])), Math.min(...visible.map(box => box[1])),
    Math.max(...visible.map(box => box[2])), Math.max(...visible.map(box => box[3]))] : null
}

export function fitFrame(bounds, width, height, { maxScale = Infinity, padding = 36 } = {}) {
  if (!(width > 0 && height > 0)) return { x: 0, y: 0, scale: 1 }
  const box = valid(bounds) ? bounds : stageBounds,
    scale = Math.max(.01, Math.min(maxScale, Math.max(1, width - padding * 2) / (box[2] - box[0]),
      Math.max(1, height - padding * 2) / (box[3] - box[1])))
  return { x: width / 2 - (box[0] + box[2]) / 2 * scale,
    y: height / 2 - (box[1] + box[3]) / 2 * scale, scale }
}

function insideStage(box) {
  if (!valid(box)) return null
  const clipped = [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(1280, box[2]), Math.min(720, box[3])]
  return valid(clipped) ? clipped : null
}

/** Камера превью: вычисляет transform; не меняет DOM и не запускает свой rAF. */
export function createPreviewCamera({ mode = 'auto' } = {}) {
  let current = null, selectedMode = mode
  const velocity = { x: 0, y: 0, scale: 0 }
  const setMode = next => {
    if (!['auto', 'closeup', 'overview'].includes(next)) throw new RangeError('Unknown framing mode')
    selectedMode = next
  }
  setMode(mode)
  return {
    get mode() { return selectedMode },
    setMode,
    reset() { current = null },
    update({ width, height, actor, props = null, detail = null, planned = null, context = null, dt = 1 / 60, reducedMotion = false }) {
      const whole = selectedMode === 'overview', base = Math.min(width / 1280, height / 720),
        visible = selectedMode === 'closeup' ? unionBounds(actor, insideStage(detail))
          : unionBounds(actor, insideStage(props), insideStage(detail)),
        bounds = whole ? stageBounds : unionBounds(visible, selectedMode === 'auto' ? insideStage(planned) : null,
          selectedMode === 'auto' ? insideStage(context) : null),
        target = fitFrame(bounds, width, height, { maxScale: whole ? base : base * (selectedMode === 'closeup' ? 5 : 3),
          padding: whole ? 0 : Math.min(36, Math.min(width, height) * .08) })
      if (!current || reducedMotion) {
        current = target
        for (const key of channels) velocity[key] = 0
      }
      else {
        // Критически затухающая пружина сохраняет скорость при смене цели:
        // после большого предмета приближение начинается без резкого разгона.
        const step = Math.min(.1, Math.max(0, dt)), frequency = 11, decay = Math.exp(-frequency * step), next = {}
        for (const key of channels) {
          const offset = current[key] - target[key], impulse = velocity[key] + frequency * offset
          next[key] = target[key] + (offset + impulse * step) * decay
          velocity[key] = (velocity[key] - impulse * frequency * step) * decay
        }
        current = next
      }
      if (!whole && visible && width > 0 && height > 0) {
        // Будущий путь задаёт плавный отъезд, а уже видимое содержимое
        // защищено сейчас: без мгновенного fit ради невидимой траектории.
        const scale = Math.min(current.scale, width / (visible[2] - visible[0]), height / (visible[3] - visible[1]))
        if (scale !== current.scale) { current.scale = scale; velocity.scale = 0 }
        const limits = { x: [-visible[0] * scale, width - visible[2] * scale],
          y: [-visible[1] * scale, height - visible[3] * scale] }
        for (const key of ['x', 'y']) {
          const value = Math.max(limits[key][0], Math.min(limits[key][1], current[key]))
          if (value !== current[key]) { current[key] = value; velocity[key] = 0 }
        }
      }
      return { ...current, bounds: bounds || stageBounds, mode: selectedMode }
    }
  }
}
