import React, { useEffect, useState } from "react";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

interface HealthData {
  status: string;
  framework: string;
  uptimeSeconds: number;
  modules: string[];
}

export function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [newText, setNewText] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch (e) {
      console.error("Backend health check failed", e);
    }
  };

  const fetchTodos = async () => {
    try {
      const res = await fetch("/api/todos");
      if (res.ok) {
        setTodos(await res.json());
      }
    } catch (e) {
      console.error("Failed to load todos", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    fetchTodos();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText })
      });
      if (res.ok) {
        const created = await res.json();
        setTodos((prev) => [...prev, created]);
        setNewText("");
      }
    } catch (e) {
      console.error("Error adding todo", e);
    }
  };

  const handleToggle = async (id: number) => {
    try {
      const res = await fetch(`/api/todos/${id}/toggle`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
      }
    } catch (e) {
      console.error("Error toggling todo", e);
    }
  };

  return (
    <div style={{ maxWidth: "720px", margin: "40px auto", padding: "0 20px" }}>
      <header style={{ marginBottom: "32px", textAlign: "center" }}>
        <h1 style={{ fontSize: "2.4rem", fontWeight: "800", background: "linear-gradient(135deg, #38bdf8, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          test-app
        </h1>
        <p style={{ color: "#94a3b8", marginTop: "8px" }}>
          Nexo Backend + React Frontend Full-stack Application
        </p>
      </header>

      {/* Backend Status Card */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "16px 20px", marginBottom: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: health?.status === "ok" ? "#22c55e" : "#ef4444", marginRight: "8px" }} />
          <strong style={{ color: "#e2e8f0" }}>Backend Status:</strong> {health ? "Connected & Online" : "Connecting..."}
        </div>
        {health && (
          <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
            Modules: <strong>{health.modules.join(", ")}</strong> | Uptime: <strong>{health.uptimeSeconds}s</strong>
          </div>
        )}
      </div>

      {/* Todo Section */}
      <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "12px", padding: "24px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "16px", color: "#f1f5f9" }}>Tasks & API Demo</h2>

        <form onSubmit={handleAddTodo} style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Add a new task..."
            style={{ flex: 1, padding: "10px 14px", borderRadius: "8px", border: "1px solid #475569", background: "#0f172a", color: "#fff", outline: "none" }}
          />
          <button
            type="submit"
            style={{ padding: "10px 20px", borderRadius: "8px", background: "#3b82f6", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}
          >
            Add Task
          </button>
        </form>

        {loading ? (
          <p style={{ color: "#94a3b8" }}>Loading tasks from Nexo API...</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {todos.map((todo) => (
              <li
                key={todo.id}
                onClick={() => handleToggle(todo.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  marginBottom: "8px",
                  background: "#0f172a",
                  cursor: "pointer",
                  border: "1px solid #334155"
                }}
              >
                <input
                  type="checkbox"
                  checked={todo.completed}
                  onChange={() => {}}
                  style={{ marginRight: "12px", cursor: "pointer" }}
                />
                <span style={{ textDecoration: todo.completed ? "line-through" : "none", color: todo.completed ? "#64748b" : "#f8fafc" }}>
                  {todo.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
