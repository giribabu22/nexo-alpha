import { httpResponse, type NexoDocumentStore, type NexoFieldSchema, type NexoModule } from "@nexo-alpha/core";
import { randomUUID } from "node:crypto";

export interface Invitation {
  id: string;
  email: string;
  role: "member" | "admin";
  createdAt: string;
  updatedAt: string;
}

const invitationBody: NexoFieldSchema = {
  type: "object",
  required: ["email"],
  properties: {
    email: { type: "string", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
    role: { type: "string", enum: ["member", "admin"] }
  }
};

export function modules(store: NexoDocumentStore): NexoModule[] {
  return [
    {
      name: "invitations",
      apis: [
        {
          name: "createInvitation",
          method: "POST",
          path: "/api/invitations",
          auth: { required: true, scopes: ["invites:write"] },
          schema: { body: invitationBody },
          handler: async (context) => {
            const body = context.payload as { email: string; role?: Invitation["role"] };
            const now = new Date().toISOString();
            const invitation: Invitation = {
              id: randomUUID(),
              email: body.email,
              role: body.role ?? "member",
              createdAt: now,
              updatedAt: now
            };
            await store.put("invitations", invitation.id, invitation);
            return httpResponse(201, invitation);
          }
        }
      ]
    }
  ];
}
