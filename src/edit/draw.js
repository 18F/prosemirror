import {elt} from "./dom"

import {toDOM} from "../model"

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

function deleteNextNodes(parent, at, amount) {
  for (let i = 0; i < amount; i++) {
    let prev = at
    at = at.nextSibling
    parent.removeChild(prev)
  }
  return at
}

export function redraw(dom, node, prev) {
  let corresponds = []
  for (let i = 0; i < prev.content.length; i++)
    corresponds.push(node.content.indexOf(prev.content[i]))

  let domPos = dom.firstChild, j = 0
  for (let i = 0; i < node.content.length; i++) {
    let child = node.content[i]
    let found = prev.content.indexOf(child)
    if (found > -1) {
      domPos = deleteNextNodes(dom, domPos, found - j)
      domPos.setAttribute("mm-path", i)
      domPos = domPos.nextSibling
      j = found + 1
    } else if (j < prev.content.length && corresponds[j] == -1 &&
               child.type.contains != "inline" && child.sameMarkup(prev.content[j])) {
      redraw(domPos, child, prev.content[j])
      domPos = domPos.nextSibling
      j++
    } else {
      dom.insertBefore(toDOM.renderNode(child, options, i), domPos)
    }
  }
  deleteNextNodes(dom, domPos, prev.content.length - j)
}
