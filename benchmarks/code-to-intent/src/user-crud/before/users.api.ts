import { NexoHttpError, httpResponse, type NexoDocumentStore, type NexoModule } from "@nexo-alpha/core";
import { randomUUID } from "node:crypto";
import { createUserSchema, updateUserSchema, type User, type UserInput } from "./user.js";

export function modules(store: NexoDocumentStore): NexoModule[] {
  async function find(id: string): Promise<User> {
    const user = await store.get<User>("users", id);
    if (user === undefined) throw new NexoHttpError(404, "NOT_FOUND", `User "${id}" not found.`);
    return user;
  }

  return [
    {
      name: "users",
      apis: [
        {
          name: "listUsers",
          method: "GET",
          path: "/api/users",
          handler: () => store.list<User>("users")
        },
        {
          name: "getUser",
          method: "GET",
          path: "/api/users/:id",
          handler: (context) => find(context.params.id!)
        },
        {
          name: "createUser",
          method: "POST",
          path: "/api/users",
          schema: { body: createUserSchema },
          handler: async (context) => {
            const input = context.payload as UserInput;
            const now = new Date().toISOString();
            const user: User = {
              id: randomUUID(),
              name: input.name,
              email: input.email,
              role: input.role ?? "member",
              createdAt: now,
              updatedAt: now
            };
            await store.put("users", user.id, user);
            return httpResponse(201, user);
          }
        },
        {
          name: "updateUser",
          method: "PATCH",
          path: "/api/users/:id",
          schema: { body: updateUserSchema },
          handler: async (context) => {
            const existing = await find(context.params.id!);
            const changes = context.payload as Partial<UserInput>;
            const user: User = {
              ...existing,
              name: changes.name ?? existing.name,
              email: changes.email ?? existing.email,
              role: changes.role ?? existing.role,
              updatedAt: new Date().toISOString()
            };
            await store.put("users", user.id, user);
            return user;
          }
        },
        {
          name: "deleteUser",
          method: "DELETE",
          path: "/api/users/:id",
          handler: async (context) => {
            await find(context.params.id!);
            await store.delete("users", context.params.id!);
            return undefined;
          }
        }
      ]
    }
  ];
}
