const pi = Math.PI,
  clamp = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)),
  looks = {
    green: { base: '#35D483', ol: '#0C6647', shade: [.48, .77, .65], hi: [1.15, 1.16, 1.14] },
    mint: { base: '#B1FFD9', ol: '#25976B', shade: [.67, .84, .75], hi: [1.15, 1.16, 1.14] },
    dark: { base: '#24684F', ol: '#123F30', shade: [.5, .7, .6], hi: [1.15, 1.16, 1.14] }
  }

/** Физические опоры историй. Точные копии изображений остаются в SVG-слое player. */
export function createStoryPropBuilders(kit) {
  const { THREE: T, U } = kit
  function build() {
    const g = new T.Group(), materials = new Map()
    function mesh(geometry, color, parent = g, options = {}) {
      const key = `${color}:${options.alpha ?? 1}:${options.outline !== false}`
      let material = materials.get(key)
      if (!material) { material = kit.material(looks[color], options); materials.set(key, material) }
      return kit.mesh(geometry, material, parent)
    }
    function box(w, h, d, color, parent = g, options) {
      return mesh(kit.rbox(w, h, d, Math.min(.6, d / 3)), color, parent, options)
    }
    return { g, mesh, box, finish(update) {
      return { g, upd(P) {
        const fade = P.fade == null ? 1 : clamp(P.fade)
        for (const material of materials.values()) kit.opacity(material, fade)
        g.visible = fade > .001
        update(P, materials.values().next().value?.m.uniforms.uOpacity.value ?? fade)
      } }
    } }
  }

  function drawText(canvas, text) {
    const ctx = canvas.getContext('2d'), width = canvas.width - 100, height = canvas.height - 100
    let font = 76, lines
    do {
      ctx.font = `600 ${font}px sans-serif`; lines = ['']
      for (const char of text) {
        const i = lines.length - 1
        if (char === '\n') lines.push('')
        else if (lines[i] && ctx.measureText(lines[i] + char).width > width) {
          const space = lines[i].lastIndexOf(' ')
          if (space > 0) { lines.push(lines[i].slice(space + 1) + char); lines[i] = lines[i].slice(0, space + 1) }
          else lines.push(char)
        } else lines[i] += char
      }
      if (lines.length * font * 1.3 <= height || font <= 12) break
      font -= 2
    } while (true)
    ctx.fillStyle = '#E7FFF2'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#174F3B'; ctx.textBaseline = 'top'
    lines.forEach((line, i) => ctx.fillText(line, 50, 50 + i * font * 1.3))
  }

  function panel() {
    const { g, box, finish } = build(), halves = [], bodies = [], screens = [], supports = [],
      canvas = document.createElement('canvas')
    g.name = 'story-panel'; canvas.width = 1200; canvas.height = 800
    for (const side of [-1, 1]) {
      const half = new T.Group(), x = side * 12, body = box(24, 32, 1.6, 'green', half,
        { alpha: .8, outline: false }), texture = new T.CanvasTexture(canvas),
        material = new T.MeshBasicMaterial({ map: texture, transparent: true }),
        screen = new T.Mesh(new T.PlaneGeometry(24 * U, 30.4 * U), material)
      half.name = side < 0 ? 'panel-left' : 'panel-right'; g.add(half); halves.push(half)
      body.name = 'panel-body'; body.position.x = x * U; bodies.push(body)
      texture.colorSpace = T.SRGBColorSpace; texture.repeat.x = .5; texture.offset.x = side < 0 ? 0 : .5
      screen.name = 'panel-content'; screen.position.set(x * U, 0, .85 * U); screen.frustumCulled = false
      half.add(screen); screens.push(screen)
      const dispose = () => { material.removeEventListener('dispose', dispose); texture.dispose() }
      material.addEventListener('dispose', dispose)
      for (const y of [-15.8, 15.8]) {
        const rail = box(24, .8, 2, 'mint', half, { outline: false })
        rail.name = y < 0 ? 'panel-lower-rail' : 'panel-upper-rail'; rail.position.set(x * U, y * U, 0)
        if (y < 0) supports.push(rail)
      }
      box(.8, 32, 2, 'mint', half, { outline: false }).position.x = side * 23.6 * U
      box(.5, 30.4, .5, 'dark', half, { outline: false }).position.z = -.95 * U
    }
    let previous
    return { ...finish((P, alpha) => {
      const text = String(P.text ?? ''), fold = clamp(P.fold || 0), content = P.content !== false
      halves[0].rotation.y = fold * pi * .485; halves[1].rotation.y = -fold * pi * .485
      bodies.forEach(body => { body.visible = content })
      if (text !== previous) {
        drawText(canvas, text); g.userData.text = text
        screens.forEach(screen => { screen.material.map.needsUpdate = true }); previous = text
      }
      screens.forEach(screen => { screen.visible = content; screen.material.opacity = alpha })
    }), contactMeshes: supports }
  }

  function lens() {
    const { g, mesh, finish } = build(), ring = mesh(new T.TorusGeometry(17 * U, 2.3 * U, 8, 36), 'green'),
      inner = mesh(new T.TorusGeometry(14.4 * U, .65 * U, 6, 36), 'mint', g, { outline: false }),
      handle = mesh(new T.CylinderGeometry(2.3 * U, 2.8 * U, 23 * U, 10), 'dark'),
      glass = mesh(new T.CylinderGeometry(14.4 * U, 14.4 * U, .5 * U, 28), 'mint', g,
        { alpha: .1, outline: false, depthWrite: false })
    g.name = 'story-lens'; ring.name = 'lens-rim'; inner.name = 'lens-inner-rim'
    handle.name = 'lens-handle'; handle.position.y = -28.5 * U
    glass.name = 'lens-glass'; glass.rotation.x = pi / 2
    const grip = mesh(new T.TorusGeometry(2.65 * U, .4 * U, 6, 14), 'mint', g, { outline: false })
    grip.rotation.x = pi / 2; grip.position.y = -37 * U
    return finish(P => { inner.scale.setScalar(1 + clamp(P.focus || 0) * .025) })
  }

  function stylus() {
    const { g, mesh, finish } = build(), shaft = mesh(new T.CylinderGeometry(1.1 * U, 1.1 * U, 26 * U, 10), 'green'),
      nib = mesh(new T.CylinderGeometry(0, 1.1 * U, 4 * U, 8), 'mint'),
      tip = mesh(new T.SphereGeometry(.7 * U, 8, 6), 'mint', g, { outline: false }),
      collar = mesh(new T.CylinderGeometry(1.4 * U, 1.4 * U, 3.5 * U, 10), 'dark')
    g.name = 'story-stylus'; shaft.rotation.x = nib.rotation.x = collar.rotation.x = pi / 2
    shaft.position.z = -1 * U; nib.position.z = 14 * U; collar.position.z = 3 * U
    tip.name = 'stylus-tip'; tip.position.z = 16 * U
    shaft.name = 'stylus-shaft'; collar.name = 'stylus-collar'
    return { ...finish(P => { tip.scale.setScalar(.7 + .6 * clamp(P.contact || 0)) }), contactMeshes: [shaft, collar] }
  }

  return { contextPanel0: panel, contextPanel1: panel, contextPanel2: panel, contextPanel3: panel,
    contextLens: lens, contextStylus: stylus }
}
