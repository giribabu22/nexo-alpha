import React from "react";
import { NexoForm, NexoResourceTable, NexoStack } from "@nexo-alpha/frontend";
import { User } from "./user.model.js";

export function UsersPage(): React.JSX.Element {
  return (
    <NexoStack>
      <NexoForm model={User} />
      <NexoResourceTable model={User} columns={["name", "email", "role"]} allowDelete />
    </NexoStack>
  );
}
