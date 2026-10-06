import React, { useState, type FormEvent } from "react";
import { NexoApiError, NexoButton, NexoInput, useApi, useMutation, useNexoClient } from "@nexo-alpha/frontend";
import type { User, UserInput } from "./user.js";

export function UsersPage(): React.JSX.Element {
  const client = useNexoClient();
  const users = useApi<User[]>("/api/users");
  const createUser = useMutation((input: UserInput) => client.post<User>("/api/users", input));
  const deleteUser = useMutation((id: string) => client.delete(`/api/users/${id}`));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<User["role"]>("member");
  const [errors, setErrors] = useState<string[]>([]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      await createUser.mutate({ name, email, role });
      setName("");
      setEmail("");
      setRole("member");
      setErrors([]);
      await users.refetch();
    } catch (error) {
      const payload = error instanceof NexoApiError ? (error.payload as { errors?: string[] }) : undefined;
      setErrors(payload?.errors ?? [String(error)]);
    }
  }

  async function remove(id: string): Promise<void> {
    await deleteUser.mutate(id);
    await users.refetch();
  }

  return (
    <div>
      <form onSubmit={(event) => void submit(event)}>
        <NexoInput label="Name *" value={name} onChange={(event) => setName(event.target.value)} />
        <NexoInput label="Email *" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as User["role"])}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        {errors.map((message) => (
          <p key={message} role="alert">
            {message}
          </p>
        ))}
        <NexoButton type="submit" disabled={createUser.loading}>
          Create
        </NexoButton>
      </form>
      {users.error ? (
        <p role="alert">
          {users.error.message}
          <NexoButton onClick={() => void users.refetch()}>Try again</NexoButton>
        </p>
      ) : users.loading ? (
        <p>Loading…</p>
      ) : users.data?.length === 0 ? (
        <p>No users yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data?.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>
                  <NexoButton variant="danger" size="sm" onClick={() => void remove(user.id)}>
                    Delete
                  </NexoButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
