import {Node, Pos, style, replace, inline, block} from "./model"

const commands = Object.create(null)

export default commands

function clearSelection(pm) {
  let sel = pm.selection
  if (!sel.empty)
    pm.applyTransform(replace(pm.doc, sel.from, sel.to))
  return sel.from
}

commands.insertHardBreak = pm => {
  let pos = clearSelection(pm)
  pm.applyTransform(inline.insertNode(pm.doc, pos, new Node.Inline("hard_break")))
}

function setInlineStyle(pm, style, to) {
  let sel = pm.selection
  if (to == null)
    to = !inline.hasStyle(pm.doc, sel.head, style)
  pm.updateDoc(inline[to ? "addStyle" : "removeStyle"](pm.doc, sel.from, sel.to, style))
}

commands.makeStrong = pm => setInlineStyle(pm, style.strong, true)
commands.removeStrong = pm => setInlineStyle(pm, style.strong, false)
commands.toggleStrong = pm => setInlineStyle(pm, style.strong, null)

commands.makeEm = pm => setInlineStyle(pm, style.em, true)
commands.removeEm = pm => setInlineStyle(pm, style.em, false)
commands.toggleEm = pm => setInlineStyle(pm, style.em, null)

function delBlockBackward(pm, pos) {
  if (pos.path.length == 1) { // Top level block, join with block above
    let before = Pos.before(pm.doc, new Pos([], pos.path[0], false))
    if (before) pm.applyTransform(replace(pm.doc, before, pos))
    return
  }

  let last = pos.path.length - 1
  let parent = pm.doc.path(pos.path.slice(last))
  let offset = pos.path[last]
  if (parent.type == Node.types.list_item &&
      offset == 0 && pos.path[last - 1] > 0) {
    // Top of list item below other list item
    // Join with the one above
    pm.applyTransform(block.join(pm.doc, pos))
  } else {
    // Any other nested block, lift up
    pm.applyTransform(block.lift(pm.doc, pos, pos))
  }
}

commands.delBackward = pm => {
  let sel = pm.selection, head = sel.head
  if (!sel.empty)
    clearSelection(pm)
  else if (sel.head.offset)
    pm.applyTransform(replace(pm.doc, new Pos(head.path, head.offset - 1), head))
  else
    delBlockBackward(pm, head)
}

function delBlockForward(pm, pos) {
  let lst = pos.path.length - 1
  let after = Pos.after(pm.doc, new Pos(pos.path.slice(0, lst), pos.path[lst] + 1, false))
  if (after) pm.applyTransform(replace(pm.doc, pos, after))
}

commands.delForward = pm => {
  let sel = pm.selection, head = sel.head
  if (!sel.empty)
    clearSelection(pm)
  else if (head.offset < pm.doc.path(head.path).size)
    pm.applyTransform(replace(pm.doc, head, new Pos(head.path, head.offset + 1)))
  else
    delBlockForward(pm, head)
}

commands.undo = pm => pm.history.undo()
commands.redo = pm => pm.history.redo()

commands.join = pm => {
  pm.applyTransform(block.join(pm.doc, pm.selection.head))
}

commands.lift = pm => {
  let sel = pm.selection
  pm.applyTransform(block.lift(pm.doc, sel.from, sel.to))
}

function wrap(pm, type) {
  let sel = pm.selection
  let node = new Node(type, null, Node.types[type].defaultAttrs)
  pm.applyTransform(block.wrap(pm.doc, sel.from, sel.to, node))
}

commands.wrapBulletList = pm => wrap(pm, "bullet_list")
commands.wrapOrderedList = pm => wrap(pm, "ordered_list")
commands.wrapBlockquote = pm => wrap(pm, "blockquote")
