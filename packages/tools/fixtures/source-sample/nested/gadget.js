import { DEFAULT_WIDGET_ID } from "../widget.js";

export class Gadget {
  constructor(name = DEFAULT_WIDGET_ID) {
    this.name = name;
  }
}

export default function makeGadget(name) {
  return new Gadget(name);
}
