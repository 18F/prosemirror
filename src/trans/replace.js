import {Node, Pos, inline} from "../model"

import {defineStep, Result, Step, Transform} from "./transform"
import {PosMap, MovedRange, CollapsedRange} from "./map"
import {slice} from "../model"

function samePathDepth(a, b) {
  for (let i = 0;; i++)
    if (i == a.path.length || i == b.path.length || a.path[i] != b.path[i])
      return i
}

function sizeBefore(node, at) {
  if (node.type.block) {
    let size = 0
    for (let i = 0; i < at; i++) size += node.content[i].size
    return size
  } else {
    return at
  }
}

export function doReplace(doc, from, to, root, repl) {
  // FIXME replace with a copyTo and inline code
  function fill(node, depth) {
    let copy = node.copy()
    if (depth < root.length) {
      copy.pushFrom(node)
      let n = root[depth]
      copy.content[n] = fill(copy.content[n], depth + 1)
    } else {
      let fromEnd = depth == from.path.length
      let start = fromEnd ? from.offset : from.path[depth]
      copy.pushNodes(node.slice(0, start))
      if (!fromEnd) {
        copy.push(slice.before(node.content[start], from, depth + 1))
        ++start
      } else {
        start = copy.content.length
      }
      // FIXME verify that these fit here
      copy.pushNodes(repl.nodes)
      let end
      if (depth == to.path.length) {
        end = to.offset
      } else {
        let n = to.path[depth]
        copy.push(slice.after(node.content[n], to, depth + 1))
        end = n + 1
      }
      copy.pushNodes(node.slice(end))

      let rightEdge = start + repl.nodes.length, startLen = copy.content.length
      if (repl.nodes.length)
        mendLeft(copy, start, depth, repl.openLeft)
      mendRight(copy, rightEdge + (copy.content.length - startLen), root,
                repl.nodes.length ? repl.openRight : from.path.length - depth)
    }
    return copy
  }

  function mendLeft(node, at, depth, open) {
    if (node.type.block)
      return inline.stitchTextNodes(node, at)

    if (open == 0 || depth == from.path.length) return

    let before = node.content[at - 1], after = node.content[at]
    if (before.sameMarkup(after)) {
      let oldSize = before.content.length
      before.pushFrom(after)
      node.content.splice(at, 1)
      mendLeft(before, oldSize, depth + 1, open - 1)
    }
  }

  var moved = []
  function addMoved(start, size, dest) {
    if (start.cmp(dest))
      moved.push(new MovedRange(start, size, dest))
  }

  function mendRight(node, at, path, open) {
    let toEnd = path.length == to.path.length
    let after = node.content[at], before

    let sBefore = toEnd ? sizeBefore(node, at) : at + 1
    let movedStart = toEnd ? to : to.shorten(path.length, 1)
    let movedSize = node.maxOffset - sBefore

    if (!toEnd && open > 0 && (before = node.content[at - 1]).sameMarkup(after)) {
      after.content = before.content.concat(after.content)
      node.content.splice(at - 1, 1)
      addMoved(movedStart, movedSize, new Pos(path, sBefore - 1))
      mendRight(after, before.content.length, path.concat(at - 1), open - 1)
    } else {
      if (node.type.block) inline.stitchTextNodes(node, at)
      addMoved(movedStart, movedSize, new Pos(path, sBefore))
      if (!toEnd) mendRight(after, 0, path.concat(at), 0)
    }
  }

  return {doc: fill(doc, 0), moved}
}

const nullRepl = {nodes: [], openLeft: 0, openRight: 0}

defineStep("replace", {
  apply(doc, data) {
    let root = data.pos.path
    if (data.from.path.length < root.length || data.to.path.length < root.length)
      return null
    for (let i = 0; i < root.length; i++)
      if (data.from.path[i] != root[i] || data.to.path[i] != root[i]) return null

    let {doc: out, moved} = doReplace(doc, data.from, data.to, root, data.param || nullRepl)
    let end = moved.length ? moved[moved.length - 1].dest : data.to
    let collapsed = new CollapsedRange(data.from, data.to, data.from, end)
    return new Result(doc, out, new PosMap(moved, [collapsed]))
  },
  invert(result, data) {
    let root = data.pos.path
    let between = slice.between(result.before, data.from, data.to, false)
    return new Step("replace", data.from, result.map.mapSimple(data.to), data.from.shorten(root.length), {
      nodes: between.path(root).content,
      openLeft: data.from.path.length - root.length,
      openRight: data.to.path.length - root.length
    })
  }
})

function buildInserted(nodesLeft, source, start, end) {
  let sliced = slice.between(source, start, end, false)
  let nodesRight = []
  for (let node = sliced, i = 0; i <= start.path.length; i++, node = node.content[0])
    nodesRight.push(node)
  let same = samePathDepth(start, end)
  let searchLeft = nodesLeft.length - 1, searchRight = nodesRight.length - 1
  let result = null

  let inner = nodesRight[searchRight]
  if (inner.type.block && inner.size && nodesLeft[searchLeft].type.block) {
    result = nodesLeft[searchLeft--].copy(inner.content)
    nodesRight[--searchRight].content.shift()
  }

  for (;;) {
    let node = nodesRight[searchRight], type = node.type, matched = null
    let outside = searchRight <= same
    for (let i = searchLeft; i >= 0; i--) {
      let left = nodesLeft[i]
      if (outside ? left.type.contains == type.contains : left.type == type) {
        matched = i
        break
      }
    }
    if (matched != null) {
      if (!result) {
        result = nodesLeft[matched].copy(node.content)
        searchLeft = matched - 1
      } else {
        while (searchLeft >= matched)
          result = nodesLeft[searchLeft--].copy([result])
        result.pushFrom(node)
      }
    }
    if (matched != null || node.content.length == 0) {
      if (outside) break
      if (searchRight) nodesRight[searchRight - 1].content.shift()
    }
    searchRight--
  }

  let repl = {nodes: result ? result.content : [],
              openLeft: start.path.length - searchRight,
              openRight: end.path.length - searchRight}
  return {repl, depth: searchLeft + 1}
}

function moveText(tr, doc, before, after) {
  let root = samePathDepth(before, after)
  let cutAt = after.shorten(null, 1)
  while (cutAt.path.length > root && doc.path(cutAt.path).content.length == 1)
    cutAt = cutAt.shorten(null, 1)
  tr.split(cutAt, cutAt.path.length - root)
  let start = after, end = new Pos(start.path, doc.path(start.path).maxOffset)
  let parent = doc.path(start.path.slice(0, root))
  let wanted = parent.pathNodes(before.path.slice(root))
  let existing = parent.pathNodes(start.path.slice(root))
  while (wanted.length && existing.length && wanted[0].sameMarkup(existing[0])) {
    wanted.shift()
    existing.shift()
  }
  if (existing.length || wanted.length)
    tr.step("ancestor", start, end, null, {depth: existing.length, wrappers: wanted})
  for (let i = root; i < before.path.length; i++)
    tr.join(before.shorten(i, 1))
}

Transform.prototype.delete = function(from, to) {
  this.replace(from, to)
  return this
}

Transform.prototype.replace = function(from, to, source, start, end) {
  let repl, depth, doc = this.doc
  if (source) {
    ;({repl, depth}) = buildInserted(doc.pathNodes(from.path), source, start, end)
  } else {
    repl = nullRepl
    depth = samePathDepth(from, to)
  }
  let root = from.shorten(depth)
  let result = this.step("replace", from, to, root, repl)

  // If no text nodes before or after end of replacement, don't glue text
  if (!doc.path(to.path).type.block) return this
  if (!(repl.nodes.length ? source.path(end.path).type.block : doc.path(from.path).type.block)) return this

  let nodesAfter = doc.path(root.path).pathNodes(to.path.slice(depth)).slice(1)
  let nodesBefore
  if (repl.nodes.length) {
    let inserted = repl.nodes
    nodesBefore = []
    for (let i = 0; i < repl.openRight; i++) {
      let last = inserted[inserted.length - 1]
      nodesBefore.push(last)
      inserted = last.content
    }
  } else {
    nodesBefore = doc.path(root.path).pathNodes(from.path.slice(depth)).slice(1)
  }
  if (nodesAfter.length != nodesBefore.length ||
      !nodesAfter.every((n, i) => n.sameMarkup(nodesBefore[i]))) {
    let after = result.map.mapSimple(to)
    let before = Pos.before(result.doc, after.shorten(null, 0))
    moveText(this, result.doc, before, after)
  }
  return this
}
