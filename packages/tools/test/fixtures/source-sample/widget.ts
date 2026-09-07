export interface Widget {
  readonly id: string;
}

export function createWidget(id: string): Widget {
  return { id };
}

export const DEFAULT_WIDGET_ID = "default";

const internalHelper = () => "not exported";

export { internalHelper as helper };
