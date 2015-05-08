import {defineOption, Range} from "../edit"
import {applyStep} from "../transform"
import {stepToJSON, stepFromJSON} from "./json"
import {rebaseChanges} from "./rebase"
import {CollabHistory} from "./history"

defineOption("collab", false, (pm, value, _, isInit) => {
  if (!isInit) throw new Error("Can't enable/disable collaboration in a running editor")
  if (!value) return

  pm.mod.collab = new Collab(pm, value)
  pm.history = new CollabHistory(pm, pm.mod.collab)
})

class Collab {
  constructor(pm, options) {
    if (!options.channel)
      throw new Error("No communication channel provided to collab module")
    this.pm = pm
    this.options = options
    this.channel = options.channel

    this.version = options.version || 0
    this.versionDoc = pm.doc

    this.unconfirmed = []
    this.outOfSync = false
    this.sending = false

    pm.on("transform", transform => {
      for (let i = 0; i < transform.steps.length; i++) {
        let data = {step: transform.steps[i], map: transform.maps[i], doc: transform.docs[i]}
        this.unconfirmed.push(data)
        this.pm.history.markStep(this.version + this.unconfirmed.length)
      }
      this.send()
    })

    this.channel.register(this)
  }

  send() {
    if (!this.outOfSync && !this.sending && this.unconfirmed.length > 0) {
      let amount = this.unconfirmed.length
      let startVersion = this.version
      let startDoc = this.pm.doc
      this.sending = true
      this.channel.send(this, this.version, this.unconfirmed.map(c => stepToJSON(c.step)), (err, ok) => {
        this.sending = false
        if (err) {
          // FIXME error handling
        } else if (!ok) {
          if (startVersion != this.version)
            this.send()
          else
            this.outOfSync = true
          // Stop trying to send until a sync comes in
          return
        } else {
          this.pm.history.markConfirmed(this.version, this.unconfirmed.slice(0, amount))
          this.unconfirmed = this.unconfirmed.slice(amount)
          this.version += amount
          this.versionDoc = startDoc
        }
        this.send()
      })
    }
  }

  receive(steps) {
    let doc = this.versionDoc
    let maps = steps.map(json => {
      let step = stepFromJSON(json)
      let result = applyStep(doc, step)
      doc = result.doc
      return result.map
    })
    let rebased = rebaseChanges(doc, maps, this.unconfirmed)
    this.unconfirmed = rebased.changes
    this.version += steps.length
    this.versionDoc = doc

    let sel = this.pm.selection
    this.pm.updateInner(rebased.doc, new Range(rebased.mapping.map(sel.from).pos,
                                               rebased.mapping.map(sel.to).pos))
    this.pm.history.markForeignChanges(maps)

    if (this.outOfSync) {
      this.outOfSync = false
      this.send()
    }
  }
}
