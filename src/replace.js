import Pos from "./pos"
import Node from "./node"
import * as slice from "./slice"
import * as join from "./join"
import PosMap from "./posmap"

export default function replace(doc, from, to, repl = null, start = null, end = null) {
  let posMap = new PosMap(doc, from)
  let origTo = to

  if (from.cmp(to) != 0) {
    from = reduceRight(doc, from)
    to = reduceLeft(doc, to)
  }
  let result = slice.before(doc, from)
  let right = slice.after(doc, to)

  if (repl) {
    if (start.cmp(end) != 0) {
      start = reduceRight(repl, start)
      end = reduceLeft(repl, end)
    }
    let collapsed = [0]
    let middle = slice.between(repl, start, end, collapsed)
    
    let endDepth = join.trackDepth(result, from.path.length, middle, start.path.length - collapsed[0])
    join.buildPosMap(posMap, origTo, result, end.path.length - collapsed[0] + endDepth, right, to)
  } else {
    join.buildPosMap(posMap, origTo, result, from.path.length, right, to)
  }

  return {map: posMap, doc: result}
}

function reduceLeft(node, pos) {
  if (pos.offset) return pos

  let max = 0
  for (let i = 0; i < pos.path.length; i++)
    if (pos.path[i]) max = i
  return new Pos(pos.path.slice(0, max), pos.path[max], false)
}

function reduceRight(node, pos) {
  let max = 0
  for (let i = 0; i < pos.path.length; i++) {
    let n = pos.path[i]
    if (n < node.content.length - 1) max = i
    node = node.content[pos.path[i]]
  }
  if (pos.offset < node.size) return pos
  return new Pos(pos.path.slice(0, max), pos.path[max] + 1, false)
}
