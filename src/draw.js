import {elt} from "./dom"
import {findByPath} from "./selection"

import {toDOM} from "./model"

const nonEditable = {html_block: true, html_tag: true, horizontal_rule: true}

const options = {
  onRender: (node, dom, offset) => {
    if (node.type.type != "inline" && offset != null)
      dom.setAttribute("mm-path", offset)
    if (nonEditable.hasOwnProperty(node.type.name))
      dom.contentEditable = false
    return dom
  },
  renderInlineFlat: (node, dom, offset) => {
    if (dom.nodeType != 1)
      dom = elt("span", null, dom)
    dom.setAttribute("mm-inline-span", offset + "-" + (offset + node.size))
    return dom
  },
  document: document
}

export function draw(dom, doc) {
  dom.innerText = ""
  dom.appendChild(toDOM(doc, options))
}

export function redraw(dom, node, prev) {
  let sameStart = 0, sameEnd = 0
  let len = node.content.length, prevLen = prev.content.length
  let diffLen = Math.min(len, prevLen)
  while (diffLen && node.content[sameStart] == prev.content[sameStart]) {
    ++sameStart
    --diffLen
  }
  while (diffLen && node.content[len - 1 - sameEnd] == prev.content[prevLen - 1 - sameEnd]) {
    ++sameEnd
    --diffLen
  }

  let pos = null
  for (let i = prevLen - 1; i >= sameStart; i--) {
    let old = findByPath(dom, i)
    if (i < prevLen - sameEnd) {
      // FIXME define a coherent strategy for redrawing inline content
      if (i < len - sameEnd && i == sameStart && node.content[i].type.contains != "inline" &&
          node.content[i].sameMarkup(prev.content[i])) {
        redraw(old, node.content[i], prev.content[i])
        ++sameStart
      } else {
        dom.removeChild(old)
      }
    } else {
      old.setAttribute("mm-path", i + (len - prevLen))
      pos = old
    }
  }
  for (let i = sameStart; i < len - sameEnd; i++)
    dom.insertBefore(toDOM.renderNode(node.content[i], options, i), pos)
}
