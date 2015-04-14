import {Pos, Node, inline} from "../model"

import {defineTransform, Result, Step} from "./transform"
import {isFlatRange, copyTo, selectedSiblings} from "./tree"
import {PosMap, Range, SinglePos} from "./map"
import {split} from "./split"
import {join} from "./join"

defineTransform("ancestor", {
  apply(doc, data) {
    let from = data.from, to = data.to
    if (!isFlatRange(from, to)) return null
    let toParent = from.path, start = from.offset, end = to.offset
    let depth = data.param.depth || 0, wrappers = data.param.wrappers || Node.empty
    if (!depth && wrappers.length == 0) return null
    for (let i = 0; i < depth; i++) {
      if (start > 0 || end < doc.path(toParent).maxOffset || toParent.length == 0) return null
      start = toParent[toParent.length - 1]
      end = start + 1
      toParent = toParent.slice(0, toParent.length - 1)
    }
    let copy = copyTo(doc, toParent)
    let parent = copy.path(toParent), inner = copy.path(from.path)
    let parentSize = parent.content.length
    if (wrappers.length) {
      if (parent.type.contains != wrappers[0].type.type ||
          wrappers[wrappers.length - 1].type.contains != inner.type.contains)
        return null
      let node = null
      for (let i = wrappers.length - 1; i >= 0; i--)
        node = wrappers[i].copy(node ? [node] : inner.content.slice(from.offset, to.offset))
      parent.content.splice(start, end - start, node)
    } else {
      if (parent.type.contains != inner.type.contains) return null
      parent.content = parent.content.slice(0, start).concat(inner.content).concat(parent.content.slice(end))
    }

    let toInner = toParent.slice()
    for (let i = 0; i < wrappers.length; i++) toInner.push(i ? 0 : start)
    let startOfInner = new Pos(toInner, wrappers.length ? 0 : start)
    let deleted = null
    if (depth > 1) {
      deleted = []
      let path = from.path, off = from.offset
      for (let i = 0; i < depth - 1; i++) {
        off = path[path.length - 1]
        path = path.slice(0, path.length - 1)
        deleted.push(new SinglePos(new Pos(path, off), new Pos(toParent, start), startOfInner),
                     new SinglePos(new Pos(path, off + 1), new Pos(toParent, end), new Pos(toInner, to.offset - from.offset)))
      }
    }
    let moved = [new Range(from, to.offset - from.offset, startOfInner)]
    let insertedSize = wrappers.length ? 1 : to.offset - from.offset
    if (end - start != insertedSize)
      moved.push(new Range(new Pos(toParent, end), parentSize - end,
                           new Pos(toParent, start + insertedSize)))
    return new Result(doc, copy, new PosMap(moved, deleted))
  }
})

function canUnwrap(container, from, to) {
  let type = container.content[from].type.contains
  for (let i = from + 1; i < to; i++)
    if (container.content[i].type.contains != type)
      return false
  return type
}

function canBeLifted(doc, range) {
  let container = doc.path(range.path)
  let parentDepth, unwrap = false, innerType = container.type.contains
  for (;;) {
    parentDepth = -1
    for (let node = doc, i = 0; i < range.path.length; i++) {
      if (node.type.contains == innerType) parentDepth = i
      node = node.content[range.path[i]]
    }
    if (parentDepth > -1) return {path: range.path.slice(0, parentDepth),
                                  unwrap: unwrap}
    if (unwrap || !(innerType = canUnwrap(container, range.from, range.to))) return null
    unwrap = true
  }
}

export function lift(doc, from, to) {
  let range = selectedSiblings(doc, from, to || from)
  let found = canBeLifted(doc, range)
  let result = [], depth = range.path.length - found.path.length
  if (!found) return result
  for (let d = 0, pos = new Pos(range.path, range.to);; d++) {
    if (pos.offset < doc.path(pos.path).content.length) {
      result = result.concat(split(pos, depth - d))
      break
    }
    if (d == depth - 1) break
    pos = pos.shorten(null, 1)
  }
  for (let d = 0, pos = new Pos(range.path, range.from);; d++) {
    if (pos.offset > 0) {
      result = result.concat(split(pos, depth - d))
      let cut = range.path.length - depth, path = pos.path.slice(0, cut).concat(pos.path[cut] + 1)
      for (let i = 0; i < d; i++) path.push(0)
      range = {path: path, from: 0, to: range.to - range.from}
      break
    }
    if (d == depth - 1) break
    pos = pos.shorten()
  }
  if (found.unwrap) {
    for (let i = range.to - 1; i > range.from; i--)
      result = result.concat(join(doc, new Pos(range.path, i)))
    let node = doc.path(range.path), size = 0
    for (let i = range.from; i < range.to; i++)
      size += node.content[i].content.length
    range = {path: range.path.concat(range.from), from: 0, to: size}
    ++depth
  }
  result.push(new Step("ancestor", new Pos(range.path, range.from),
                       new Pos(range.path, range.to), {depth: depth}))
  return result
}

export function wrap(doc, from, to, node) {
  let range = selectedSiblings(doc, from, to || from)
  let parent = doc.path(range.path)
  let around = Node.findConnection(parent.type, node.type)
  let inside = Node.findConnection(node.type, parent.content[range.from].type)
  if (!around || !inside) return []
  let wrappers = around.map(t => new Node(t)).concat(node).concat(inside.map(t => new Node(t)))
  let result = [new Step("ancestor", new Pos(range.path, range.from), new Pos(range.path, range.to),
                         {wrappers: wrappers})]
  if (inside.length) {
    let toInner = range.path.slice()
    for (let i = around.length + inside.length + 1; i > 0; i--)
      toInner.push(0)
    for (let i = range.to - 1 - range.from; i > 0; i--)
      result = result.concat(split(new Pos(toInner, i), inside.length))
  }
  return result
}

export function setBlockType(doc, from, to, node) {
  // FIXME
}
