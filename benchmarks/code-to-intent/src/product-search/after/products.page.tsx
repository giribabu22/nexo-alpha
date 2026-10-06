import React from "react";
import { NexoResourceTable } from "@nexo-alpha/frontend";
import { Product } from "./product.model.js";

export function ProductsPage(): React.JSX.Element {
  return <NexoResourceTable model={Product} search pageSize={20} />;
}
