export class Gadget {
  constructor(name) {
    this.name = name;
  }
}

export default function makeGadget(name) {
  return new Gadget(name);
}
