import { field, model, type Infer } from "@nexo-alpha/core/model";

export const Product = model("products", {
  name: field.string({ minLength: 1 }),
  price: field.number({ min: 0 }),
  category: field.enum(["tools", "toys", "books"])
});
export type Product = Infer<typeof Product>;
