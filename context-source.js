// Допуск только для измерений сцены; смысловые числа и авторская разметка точные.
const geometryTolerance = .01,
  imageVersion = element => /^svg$/i.test(element?.tagName || '') ? element.outerHTML
    : /^img$/i.test(element?.tagName || '') ? JSON.stringify([element.currentSrc, element.src, element.srcset, element.sizes]) : null,
  lineAttributes = ['data-buddy-points', 'd', 'points', 'x1', 'y1', 'x2', 'y2', 'transform']

export function contextSource(selection) {
  const geometry = [...selection.bounds],
    measured = (value, keys) => value && Object.fromEntries(Object.entries(value).map(([key, number]) => {
      if (keys.includes(key) && Number.isFinite(number)) { geometry.push(number); return [key, null] }
      return [key, number]
    })),
    target = value => measured(value, ['x', 'y', 'width', 'height']),
    points = values => values?.map(value => measured(value, ['x', 'y'])),
    original = selection.fact, structure = original.structure,
    fact = { ...original, ...(original.target ? { target: target(original.target) } : {}),
      ...(structure ? { structure: { ...structure,
        ...(structure.items ? { items: structure.items.map(item => ({ ...item, target: target(item.target) })) } : {}),
        ...(structure.points ? { points: points(structure.points) } : {}),
        ...(structure.edges ? { edges: structure.edges.map(edge => ({ ...edge, points: points(edge.points) })) } : {}) } } : {}) },
    parts = (selection.parts || []).map(part => {
      geometry.push(...part.bounds)
      return [part.id, part.media, imageVersion(part.element)]
    }),
    selector = original.kind === 'chart' ? '[data-buddy-chart-line]' : original.kind === 'flow' ? '[data-buddy-from], [data-buddy-to]' : null,
    lines = selector ? [...(selection.element?.querySelectorAll?.(selector) || [])] : []
  if (selector && (selection.element?.hasAttribute?.('data-buddy-chart-line')
    || selection.element?.hasAttribute?.('data-buddy-from') || selection.element?.hasAttribute?.('data-buddy-to'))) lines.unshift(selection.element)
  return { element: selection.element, parts: (selection.parts || []).map(part => part.element), lines, geometry,
    semantic: JSON.stringify([fact, imageVersion(selection.element), parts,
      lines.map(line => lineAttributes.map(name => line.getAttribute(name)))]) }
}

export function sameContextSource(selection, previous) {
  const current = contextSource(selection)
  return current.element === previous.element && current.semantic === previous.semantic
    && current.parts.length === previous.parts.length && current.parts.every((element, i) => element === previous.parts[i])
    && current.lines.length === previous.lines.length && current.lines.every((element, i) => element === previous.lines[i])
    && current.geometry.length === previous.geometry.length
    && current.geometry.every((value, i) => Math.abs(value - previous.geometry[i]) <= geometryTolerance)
}
