import {Transition, VersionStore} from "../src/collab/versions"
import {mergeChangeSets, mapPosition, rebaseChanges} from "../src/collab/rebase"
import {nullID, xorIDs, randomID} from "../src/collab/id"
import {Pos, Node, style} from "../src/model"
import {Tr} from "../src/transform"

import {doc, blockquote, h1, p, li, ol, ul, em, a, br} from "./build"
import Failure from "./failure"
import {defTest} from "./tests"
import {cmpNode, cmpStr} from "./cmp"

function merge(name, known, add, expect) {
  defTest("merge_changes_" + name, () => {
    function parse(str) {
      return str.split(" ").map(s => { let m = s.match(/([a-z]+)(\d+)/); return {clientID: m[1], id: m[2]} })
    }
    function flat(lst) {
      return lst.map(c => c.clientID + c.id).join(" ")
    }
    let result = flat(mergeChangeSets(parse(known), parse(add)))
    if (result != expect)
      throw new Failure("Expected " + expect + " got " + result)
  })
}

merge("simple",
      "b1 b2", "a1 a2", "a1 a2 b1 b2")
merge("keep",
      "a1 a2", "b1 b2", "a1 a2 b1 b2")
merge("same_source",
      "a1 a2 a3 b1 b2", "a4 a5", "a1 a2 a3 a4 a5 b1 b2")

function mapObj(obj, f) {
  let result = {}
  for (let prop in obj) result[prop] = f(prop, obj[prop])
  return result
}

function asPos(doc, val) {
  if (typeof val == "string") {
    let m = val.match(/^(\w+)([-+]\d+)?$/)
    let pos = doc.tag[m[1]]
    if (!pos) throw new Error("Referenced non-existing tag " + m[1])
    if (m[2]) pos = new Pos(pos.path, pos.offset + Number(m[2]))
    return pos
  }
  return val
}

function text(pos, text) {
  return tr => tr.insertText(asPos(tr.doc, pos), text)
}
function wrap(from, to, type, attrs) {
  return tr => tr.wrap(asPos(tr.doc, from), asPos(tr.doc, to), new Node(type, null, attrs))
}
function rm(from, to) {
  return tr => tr.delete(asPos(tr.doc, from), asPos(tr.doc, to))
}
function join(pos) {
  return tr => tr.join(asPos(tr.doc, pos))
}
function addSt(from, to, st) {
  return tr => tr.addStyle(asPos(tr.doc, from), asPos(tr.doc, to), st)
}
function rmSt(from, to, st) {
  return tr => tr.removeStyle(asPos(tr.doc, from), asPos(tr.doc, to), st)
}
function repl(from, to, source, start, end) {
  return tr => tr.replace(asPos(tr.doc, from), asPos(tr.doc, to), source, start, end)
}
function addNode(pos, type, attrs) {
  return tr => tr.insert(asPos(tr.doc, pos), new Node(type, null, attrs))
}

function runRebase(startDoc, clients, result) {
  let store = new VersionStore
  store.storeVersion(nullID, null, startDoc)
  let allTransitions = []
  clients.forEach((changes, clientID) => {
    let doc = startDoc, id = nullID
    let tags = doc.tag
    let transitions = changes.map(change => {
      let tID = randomID()
      let transform = change(Tr(doc))
      let transition = new Transition(tID, id, clientID, transform)
      id = xorIDs(id, tID)
      store.storeVersion(id, transition.baseID, transform.doc)
      store.storeTransition(transition)
      doc = transform.doc
      tags = doc.tag = mapObj(tags, (_, value) => transform.mapSimple(value))
      return transition
    })
    allTransitions = mergeChangeSets(allTransitions, transitions)
  })

  let rebased = rebaseChanges(nullID, allTransitions, store)
  cmpNode(rebased.doc, result)
  for (let tag in startDoc.tag) {
    let mapped = mapPosition([], rebased.forward, startDoc.tag[tag])
    let expected = result.tag[tag]
    if (mapped.deleted) {
      if (expected)
        throw new Failure("Tag " + tag + " was unexpectedly deleted")
    } else {
      if (!expected)
        throw new Failure("Tag " + tag + " is not actually deleted")
      cmpStr(mapped.pos, expected, tag)
    }
  }
}

function rebase(name, startDoc, ...clients) {
  let result = clients.pop()
  defTest("rebase_" + name, () => runRebase(startDoc, clients, result))
}

function permute(array) {
  if (array.length < 2) return [array]
  let result = []
  for (let i = 0; i < array.length; i++) {
    let others = permute(array.slice(0, i).concat(array.slice(i + 1)))
    for (let j = 0; j < others.length; j++)
      result.push([array[i]].concat(others[j]))
  }
  return result
}

function rebase$(name, startDoc, ...clients) {
  let result = clients.pop()
  defTest("rebase_" + name, () => {
    permute(clients).forEach(clients => runRebase(startDoc, clients, result))
  })
}

rebase$("type_simple",
        doc(p("h<1>ell<2>o")),
        [text("1", "X")],
        [text("2", "Y")],
        doc(p("hX<1>ellY<2>o")))

rebase$("type_simple_multiple",
        doc(p("h<1>ell<2>o")),
        [text("1", "X"), text("1", "Y"), text("1", "Z")],
        [text("2", "U"), text("2", "V")],
        doc(p("hXYZ<1>ellUV<2>o")))

rebase$("type_three",
        doc(p("h<1>ell<2>o th<3>ere")),
        [text("1", "X")],
        [text("2", "Y")],
        [text("3", "Z")],
        doc(p("hX<1>ellY<2>o thZ<3>ere")))

rebase$("wrap",
        doc(p("<1>hell<2>o<3>")),
        [text("2", "X")],
        [wrap("1", "3", "blockquote")],
        doc(blockquote(p("<1>hellX<2>o<3>"))))

rebase$("delete",
        doc(p("hello<1> wo<2>rld<3>!")),
        [rm("1", "3")],
        [text("2", "X")],
        doc(p("hello<1><3>!")))

rebase("delete_twice",
       doc(p("hello<1> wo<2>rld<3>!")),
       [rm("1", "3")],
       [rm("1", "3")],
       doc(p("hello<1><3>!")))

rebase$("join",
        doc(ul(li(p("one")), "<1>", li(p("tw<2>o")))),
        [text("2", "A")],
        [join("1")],
        doc(ul(li(p("one"), p("twA<2>o")))))

rebase("style",
       doc(p("hello <1>wo<2>rld<3>")),
       [addSt("1", "3", style.em)],
       [text("2", "_")],
       doc(p("hello <1>", em("wo"), "_<2>", em("rld<3>"))))

rebase("style_unstyle",
       doc(p(em("<1>hello"), " world<2>")),
       [addSt("1", "2", style.em)],
       [rmSt("1", "2", style.em)],
       doc(p("<1>hello", em(" world<2>"))))

rebase("unstyle_style",
       doc(p("<1>hello ", em("world<2>"))),
       [rmSt("1", "2", style.em)],
       [addSt("1", "2", style.em)],
       doc(p(em("<1>hello "), "world<2>")))

rebase("replace_nested",
       doc(p("b<before>efore"), blockquote(ul(li(p("o<1>ne")), li(p("t<2>wo")), li(p("thr<3>ee")))), p("a<after>fter")),
       [repl("1", "3", doc(p("a"), blockquote(p("b")), p("c")), new Pos([0], 1), new Pos([2], 0))],
       [text("2", "ayay")],
       doc(p("b<before>efore"), blockquote(ul(li(p("o"), blockquote(p("b")), p("<1><3>ee")))), p("a<after>fter")))

rebase$("map_through_insert",
        doc(p("X<1>X<2>X")),
        [text("1", "hello")],
        [text("2", "goodbye"), rm("2-6", "2-3")],
        doc(p("Xhello<1>Xgbye<2>X")))

rebase("double_remove",
       doc(p("a"), "<1>", p("b"), "<2>", p("c")),
       [rm("1", "2")],
       [rm("1", "2")],
       doc(p("a"), "<1><2>", p("c")))

rebase$("edit_in_removed",
        doc(p("a"), "<1>", p("b<2>"), "<3>", p("c")),
        [rm("1", "3")],
        [text("2", "ay")],
        doc(p("a"), "<1><3>", p("c")))

rebase("double_insert",
       doc(p("a"), "<1>", p("b")),
       [addNode("1", "paragraph")],
       [addNode("1", "paragraph")],
       doc(p("a"), p(), p(), "<1>", p("b")))
