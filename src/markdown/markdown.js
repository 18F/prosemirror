// Glue code that makes ProseMirror aware of the Markdown parser and
// serializer.

import fromText from "./from_text"
import toText from "./to_text"
import text from "../edit/text"
import {ProseMirror, defineOption} from "../edit"

text.toMarkdown = toText
text.fromMarkdown = fromText

Object.defineProperty(ProseMirror.prototype, "markdownValue", {
  get() { return toText(this.doc) },
  set(text) { this.update(fromText(text)) }
})

defineOption("markdownValue", null, function(pm, value) {
  if (value != null) pm.update(fromText(value))
})
