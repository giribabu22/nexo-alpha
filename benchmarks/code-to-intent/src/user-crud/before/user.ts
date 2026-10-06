import type { NexoFieldSchema } from "@nexo-alpha/core";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "member" | "admin";
  createdAt: string;
  updatedAt: string;
}

export type UserInput = Pick<User, "name" | "email"> & Partial<Pick<User, "role">>;

const properties: Record<string, NexoFieldSchema> = {
  name: { type: "string", minLength: 1 },
  email: { type: "string", pattern: "^[^\s@]+@[^\s@]+\.[^\s@]+$" },
  role: { type: "string", enum: ["member", "admin"] }
};

export const createUserSchema: NexoFieldSchema = { type: "object", required: ["name", "email"], properties };
export const updateUserSchema: NexoFieldSchema = { type: "object", properties };
