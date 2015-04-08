import {Node, Pos, style, inline} from "../model"
import {splitAt, joinPoint, liftableRange, wrappableRange,
        describeTarget, describePos, insertText, insertInline,
        removeNode} from "../transform"

const commands = Object.create(null)

export function registerCommand(name, func) {
  commands[name] = func
}

export function execCommand(pm, name) {
  let ext = pm.input.commandExtensions[name]
  if (ext && ext.high) for (let i = 0; i < ext.high.length; i++)
    if (ext.high[i](pm) !== false) return true
  if (ext && ext.normal) for (let i = 0; i < ext.normal.length; i++)
    if (ext.normal[i](pm) !== false) return true
  let base = commands[name]
  if (base && base(pm) !== false) return true
  if (ext && ext.low) for (let i = 0; i < ext.low.length; i++)
    if (ext.low[i](pm) !== false) return true
  return false
}

function clearSelection(pm) {
  let sel = pm.selection
  if (!sel.empty)
    pm.apply({name: "replace", pos: sel.from, end: sel.to})
  return sel.from
}

commands.insertHardBreak = pm => {
  pm.scrollIntoView()
  let pos = clearSelection(pm)
  if (pm.doc.path(pos.path).type == Node.types.code_block)
    return pm.apply(insertText(pos, "\n"))
  else
    return pm.apply(insertInline(pos, {type: "hard_break"}))
}

commands.setStrong = pm => pm.setInlineStyle(style.strong, true)
commands.unsetStrong = pm => pm.setInlineStyle(style.strong, false)
commands.toggleStrong = pm => pm.setInlineStyle(style.strong, null)

commands.setEm = pm => pm.setInlineStyle(style.em, true)
commands.unsetEm = pm => pm.setInlineStyle(style.em, false)
commands.toggleEm = pm => pm.setInlineStyle(style.em, null)

commands.setCode = pm => pm.setInlineStyle(style.code, true)
commands.unsetCode = pm => pm.setInlineStyle(style.code, false)
commands.toggleCode = pm => pm.setInlineStyle(style.code, null)

function blockBefore(pos) {
  for (let i = pos.path.length - 1; i >= 0; i--) {
    let offset = pos.path[i] - 1
    if (offset >= 0) return pos.path.slice(0, i).concat(offset)
  }
}

function delBlockBackward(pm, pos) {
  if (pos.path.length == 1) { // Top level block, join with block above
    let iBefore = Pos.before(pm.doc, new Pos([], pos.path[0]))
    let bBefore = blockBefore(pos)
    if (iBefore && bBefore) {
      if (iBefore.cmp(Pos.shorten(bBefore)) > 0) bBefore = null
      else iBefore = null
    }
    if (iBefore)
      pm.apply({name: "replace", pos: iBefore, end: pos})
    else if (bBefore)
      pm.apply(removeNode(pm.doc, bBefore, {from: "right"}))
    else
      return false
  } else {
    let last = pos.path.length - 1
    let parent = pm.doc.path(pos.path.slice(0, last))
    let offset = pos.path[last]
    let range
    // Top of list item below other list item
    // Join with the one above
    if (parent.type == Node.types.list_item &&
        offset == 0 && pos.path[last - 1] > 0)
      return pm.apply(joinPoint(pm.doc, pos))
    // Any other nested block, lift up
    else if (range = liftableRange(pm.doc, pos, pos))
      return pm.apply(range)
    else
      return false
  }
}

// FIXME maybe make deleting inside of a list join items rather than escape to top?

commands.delBackward = pm => {
  pm.scrollIntoView()
  let sel = pm.selection, head = sel.head
  if (!sel.empty)
    clearSelection(pm)
  else if (sel.head.offset)
    return pm.apply({name: "replace", pos: new Pos(head.path, head.offset - 1), end: head})
  else
    return delBlockBackward(pm, head)
}

function blockAfter(doc, pos) {
  let path = pos.path
  while (path.length > 0) {
    let end = path.length - 1
    let offset = path[end] + 1
    path = path.slice(0, end)
    let node = doc.path(path)
    if (offset < node.content.length)
      return path.concat(offset)
  }
}

function delBlockForward(pm, pos) {
  let lst = pos.path.length - 1
  let iAfter = Pos.after(pm.doc, new Pos(pos.path.slice(0, lst), pos.path[lst] + 1))
  let bAfter = blockAfter(pm.doc, pos)
  if (iAfter && bAfter) {
    if (iAfter.cmp(Pos.shorten(bAfter)) < 0) bAfter = null
    else iAfter = null
  }
  if (iAfter)
    pm.apply({name: "replace", pos: pos, end: iAfter})
  else if (bAfter)
    pm.apply(removeNode(pm.doc, bAfter, {from: "left"}))
  else
    return false
}

commands.delForward = pm => {
  pm.scrollIntoView()
  let sel = pm.selection, head = sel.head
  if (!sel.empty)
    clearSelection(pm)
  else if (head.offset < pm.doc.path(head.path).size)
    return pm.apply({name: "replace", pos: head, end: new Pos(head.path, head.offset + 1)})
  else
    return delBlockForward(pm, head)
}

function scrollAnd(pm, value) {
  pm.scrollIntoView()
  return value
}

commands.undo = pm => scrollAnd(pm, pm.history.undo())
commands.redo = pm => scrollAnd(pm, pm.history.redo())

commands.join = pm => {
  let point = joinPoint(pm.doc, pm.selection.head)
  if (point) {
    pm.scrollIntoView()
    pm.apply(point)
  }
}

commands.lift = pm => {
  let sel = pm.selection
  let range = liftableRange(pm.doc, sel.from, sel.to)
  if (range) {
    pm.scrollIntoView()
    return pm.apply(range)
  } else {
    return false
  }
}

function wrap(pm, type) {
  let sel = pm.selection
  pm.scrollIntoView()
  return pm.apply(wrappableRange(pm.doc, sel.from, sel.to, type))
}

commands.wrapBulletList = pm => wrap(pm, "bullet_list")
commands.wrapOrderedList = pm => wrap(pm, "ordered_list")
commands.wrapBlockquote = pm => wrap(pm, "blockquote")

commands.endBlock = pm => {
  pm.scrollIntoView()
  let head = clearSelection(pm)
  let block = pm.doc.path(head.path), range
  if (head.path.length > 1 && block.content.length == 0 &&
      (range = liftableRange(pm.doc, head, head))) {
    return pm.apply(range)
  } else if (block.type == Node.types.code_block && head.offset < block.size) {
    return pm.apply(insertText(head, "\n"))
  } else {
    let end = head.path.length - 1
    let isList = head.path.length > 1 && head.path[end] == 0 &&
        pm.doc.path(head.path.slice(0, end)).type == Node.types.list_item
    let type = head.offset == block.size ? "paragraph" : null
    return pm.apply(splitAt(pm.doc, head, isList ? 2 : 1, type})
  }
}

function setType(pm, type, attrs) {
  let sel = pm.selection
  pm.scrollIntoView()
  return pm.apply({name: "setType", pos: sel.from, end: sel.to,
                   type: type, attrs: attrs})
}

commands.makeH1 = pm => setType(pm, "heading", {level: 1})
commands.makeH2 = pm => setType(pm, "heading", {level: 2})
commands.makeH3 = pm => setType(pm, "heading", {level: 3})
commands.makeH4 = pm => setType(pm, "heading", {level: 4})
commands.makeH5 = pm => setType(pm, "heading", {level: 5})
commands.makeH6 = pm => setType(pm, "heading", {level: 6})

commands.makeParagraph = pm => setType(pm, "paragraph")
commands.makeCodeBlock = pm => setType(pm, "code_block")

function insertOpaqueBlock(pm, type, attrs) {
  pm.scrollIntoView()
  let sel = pm.selection
  if (!sel.empty) return false
  let parent = pm.doc.path(sel.head.path)
  if (parent.type.type != "block") return false
  if (sel.head.offset) {
    pm.apply(splitAt(pm.doc, sel.head))
    sel = pm.selection
  }
  let desc = describePos(pm.doc, sel.head.shorten(), "right")
  pm.apply({name: "insert", pos: desc.pos, posInfo: desc.info, type: type, attrs: attrs})
}

commands.insertRule = pm => insertOpaqueBlock(pm, "horizontal_rule")
