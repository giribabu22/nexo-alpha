import { field, model } from "@nexo-alpha/core";

/** Shared by both variants (and not counted): the feature is starting the app, not declaring the model. */
export const Task = model("tasks", {
  title: field.string({ minLength: 1 }),
  done: field.boolean().default(false)
});
