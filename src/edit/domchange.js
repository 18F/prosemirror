import {fromDOM, Node, Pos, findDiffStart, findDiffEnd} from "../model"
import {T} from "../transform"

import {findByPath} from "./selection"

function isAtEnd(node, pos, depth) {
  for (let i = depth || 0; i < pos.path.length; i++) {
    let n = pos.path[depth]
    if (n < node.content.length - 1) return false
    node = node.content[n]
  }
  return pos.offset == node.maxOffset
}
function isAtStart(pos, depth) {
  if (pos.offset > 0) return false
  for (let i = depth || 0; i < pos.path.length; i++)
    if (pos.path[depth] > 0) return false
  return true
}

function parseNearSelection(pm) {
  let dom = pm.content, node = pm.doc
  let from = pm.selection.from, to = pm.selection.to
  for (let depth = 0;; depth++) {
    let toNode = node.content[to.path[depth]]
    let fromStart = isAtStart(from, depth + 1)
    let toEnd = isAtEnd(toNode, to, depth + 1)
    if (fromStart || toEnd || from.path[depth] != to.path[depth] || toNode.type.block) {
      let startOffset = depth == from.depth ? from.offset : from.path[depth]
      if (fromStart && startOffset > 0) startOffset--
      let endOffset = depth == to.depth ? to.offset : to.path[depth] + 1
      if (toEnd && endOffset < node.content.length - 1) endOffset++
      let parsed = fromDOM(dom, {topNode: node.copy(), from: startOffset, to: dom.childNodes.length - (node.content.length - endOffset)})
      parsed.content = node.content.slice(0, startOffset).concat(parsed.content).concat(node.content.slice(endOffset))
      for (let i = depth - 1; i >= 0; i--) {
        let wrap = pm.doc.path(from.path.slice(0, i))
        let copy = wrap.copy(wrap.content.slice())
        copy.content[from.path[i]] = parsed
        parsed = copy
      }
      return parsed
    }
    node = toNode
    dom = findByPath(dom, from.path[depth], false)
  }
}

export function applyDOMChange(pm) {
  let updated = parseNearSelection(pm)
  let changeStart = findDiffStart(pm.doc, updated)
  if (changeStart) {
    let changeEnd = findDiffEndConstrained(pm.doc, updated, changeStart)
    pm.apply(pm.tr.replace(changeStart.a, changeEnd.a, updated, changeStart.b, changeEnd.b))
    pm.operation.fullRedraw = true
    return true
  } else {
    return false
  }
}

function offsetBy(first, second, paths) {
  for (let i = 0; i < first.path.length; i++) {
    let diff = second.path[i] - first.path[i]
    if (diff)
      return {a: paths.a.offsetAt(i, diff), b: paths.b.offsetAt(i, diff)}
  }
  let diff = second.offset - first.offset
  return {a: paths.a.shift(diff), b: paths.b.shift(diff)}
}

function findDiffEndConstrained(a, b, start) {
  let end = findDiffEnd(a, b)
  if (!end) return end
  if (end.a.cmp(start.a) < 0) return offsetBy(end.a, start.a, end)
  if (end.b.cmp(start.b) < 0) return offsetBy(end.b, start.b, end)
  return end
}
