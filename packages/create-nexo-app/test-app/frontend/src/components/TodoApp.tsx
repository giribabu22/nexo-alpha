import React, { useState } from 'react';

export function TodoApp({ todos, onAdd, onToggle, loading }: any) {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onAdd(text);
      setText("");
    }
  };

  return (
    <div className="glass-panel">
      <h2 style={{ fontSize: "1.5rem", marginBottom: "24px", fontWeight: 700 }}>Interactive Demo</h2>
      
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "12px", marginBottom: "32px" }}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's your next task?"
          style={{ 
            flex: 1, padding: "14px 20px", borderRadius: "12px", 
            border: "1px solid var(--border-color)", background: "rgba(0,0,0,0.2)", 
            color: "var(--text-primary)", fontSize: "1rem", outline: "none",
            transition: "all 0.2s ease"
          }}
          onFocus={(e) => e.target.style.borderColor = "var(--accent-primary)"}
          onBlur={(e) => e.target.style.borderColor = "var(--border-color)"}
        />
        <button
          type="submit"
          style={{ 
            padding: "14px 28px", borderRadius: "12px", 
            background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))", 
            color: "#fff", border: "none", fontWeight: 600, fontSize: "1rem", cursor: "pointer",
            transition: "transform 0.2s ease",
            boxShadow: "0 4px 14px rgba(56, 189, 248, 0.4)"
          }}
          onMouseOver={(e) => e.currentTarget.style.transform = "translateY(-2px)"}
          onMouseOut={(e) => e.currentTarget.style.transform = "translateY(0)"}
        >
          Add
        </button>
      </form>

      {loading ? (
        <div style={{ textAlign: "center", color: "var(--text-secondary)", padding: "20px" }}>Loading tasks...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {todos.map((todo: any) => (
            <div
              key={todo.id}
              onClick={() => onToggle(todo.id)}
              style={{
                display: "flex", alignItems: "center", padding: "16px 20px",
                borderRadius: "12px", background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border-color)", cursor: "pointer",
                transition: "all 0.2s ease",
                transform: "translateY(0)"
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.transform = "translateX(4px)"; }}
              onMouseOut={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.transform = "translateX(0)"; }}
            >
              <div style={{ 
                width: "24px", height: "24px", borderRadius: "50%", 
                border: `2px solid ${todo.completed ? "var(--success)" : "var(--border-color)"}`,
                background: todo.completed ? "var(--success)" : "transparent",
                marginRight: "16px", display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s ease"
              }}>
                {todo.completed && <span style={{ color: "#fff", fontSize: "14px" }}>✓</span>}
              </div>
              <span style={{ 
                fontSize: "1.1rem", 
                color: todo.completed ? "var(--text-secondary)" : "var(--text-primary)",
                textDecoration: todo.completed ? "line-through" : "none",
                transition: "all 0.2s ease"
              }}>
                {todo.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
