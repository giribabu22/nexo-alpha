import { field, model, type Infer } from "@nexo-alpha/core/model";

export const User = model("users", {
  name: field.string({ minLength: 1 }),
  email: field.email(),
  role: field.enum(["member", "admin"]).default("member")
});
export type User = Infer<typeof User>;
