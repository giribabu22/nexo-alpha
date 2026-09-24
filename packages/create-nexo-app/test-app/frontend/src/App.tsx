import React, { useEffect, useState, useMemo } from "react";
import {
  nexoComp,
  NexoPage,
  NexoCard,
  NexoBadge,
  NexoMetric,
  NexoButton,
  NexoInput,
  NexoTabs,
  NexoTerminal,
  NexoServerStatus,
  NexoKnowledgeInspector,
  NexoModuleGraph,
  useNexoHealth,
  useNexoKnowledge,
  createNexoClient,
  type TerminalEntry
} from "@nexo-alpha/frontend";

// Global typed Nexo API client
const nexo = createNexoClient({ baseUrl: window.location.origin });

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// NexoComp: Navbar
// ---------------------------------------------------------------------------
export const NavbarComp = nexoComp({
  name: "Navbar",
  purpose: "Top navigation bar with live status badge and system information",
  render: ({ uptimeSeconds, isOnline }: { uptimeSeconds?: number; isOnline: boolean }) => {
    return (
      <header
        style={{
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          background: "rgba(10, 15, 26, 0.75)",
          backdropFilter: "blur(16px)",
          position: "sticky",
          top: 0,
          zIndex: 100,
          padding: "14px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: "1.2rem",
              color: "#fff",
              boxShadow: "0 0 20px rgba(56, 189, 248, 0.4)"
            }}
          >
            N
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 800, fontSize: "1.15rem", letterSpacing: "-0.01em" }}>
                Nexo Fullstack Studio
              </span>
              <NexoBadge variant="purple" size="sm">v0.5.0</NexoBadge>
            </div>
            <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
              React In Background • NexoComp UI Architecture • DSC Optimization
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <NexoBadge variant={isOnline ? "success" : "danger"} pulse={isOnline}>
            {isOnline ? "Server Online" : "Server Disconnected"}
          </NexoBadge>
          {uptimeSeconds !== undefined && (
            <span style={{ fontSize: "0.8rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
              Uptime: <strong style={{ color: "#f8fafc" }}>{uptimeSeconds}s</strong>
            </span>
          )}
        </div>
      </header>
    );
  }
});

// ---------------------------------------------------------------------------
// NexoComp: KpiMetricsGrid
// ---------------------------------------------------------------------------
export const KpiMetricsGridComp = nexoComp({
  name: "KpiMetricsGrid",
  purpose: "High-density KPI dashboard showing system health, task counts, and DSC savings",
  render: ({
    totalTodos,
    completedTodos,
    moduleCount,
    uptime
  }: {
    totalTodos: number;
    completedTodos: number;
    moduleCount: number;
    uptime: number;
  }) => {
    const completionRate = totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 0;

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px"
        }}
      >
        <NexoMetric
          label="Registered Modules"
          value={moduleCount}
          icon="🧩"
          trend={{ direction: "up", value: "2 modules active" }}
          accentColor="#38bdf8"
        />
        <NexoMetric
          label="Active Task Progress"
          value={`${completionRate}%`}
          icon="✅"
          trend={{ direction: "neutral", value: `${completedTodos}/${totalTodos} done` }}
          accentColor="#4ade80"
        />
        <NexoMetric
          label="DSC Token Reduction"
          value="~78.1%"
          icon="⚡"
          trend={{ direction: "up", value: "delta caching" }}
          accentColor="#c084fc"
        />
        <NexoMetric
          label="Engine Uptime"
          value={`${uptime}s`}
          icon="⏱️"
          trend={{ direction: "up", value: "stable" }}
          accentColor="#fbbf24"
        />
      </div>
    );
  }
});

// ---------------------------------------------------------------------------
// NexoComp: TodoManager
// ---------------------------------------------------------------------------
export const TodoManagerComp = nexoComp({
  name: "TodoManager",
  purpose: "Interactive CRUD task manager with optimistic updates and event logging",
  dependencies: ["todos", "system"],
  render: ({
    todos,
    loading,
    onAdd,
    onToggle
  }: {
    todos: Todo[];
    loading: boolean;
    onAdd: (text: string) => void;
    onToggle: (id: number) => void;
  }) => {
    const [text, setText] = useState("");
    const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

    const filtered = useMemo(() => {
      if (filter === "active") return todos.filter((t) => !t.completed);
      if (filter === "completed") return todos.filter((t) => t.completed);
      return todos;
    }, [todos, filter]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!text.trim()) return;
      onAdd(text.trim());
      setText("");
    };

    return (
      <NexoCard
        title="Todo Tasks Module"
        subtitle="Fullstack reactive operations connected to backend todos module via NexoClient"
        badge={<NexoBadge variant="cyan">{todos.length} items</NexoBadge>}
        icon="📋"
        variant="glow"
      >
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <NexoInput
            placeholder="Type a new task name (e.g. Implement DSC hash caching)..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading}
          />
          <NexoButton type="submit" variant="primary" loading={loading} icon="＋">
            Add
          </NexoButton>
        </form>

        {/* Filter controls */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <NexoButton
            type="button"
            variant={filter === "all" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All ({todos.length})
          </NexoButton>
          <NexoButton
            type="button"
            variant={filter === "active" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setFilter("active")}
          >
            Active ({todos.filter((t) => !t.completed).length})
          </NexoButton>
          <NexoButton
            type="button"
            variant={filter === "completed" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setFilter("completed")}
          >
            Completed ({todos.filter((t) => t.completed).length})
          </NexoButton>
        </div>

        {/* List items */}
        {loading && todos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px", color: "var(--nexo-text-secondary, #94a3b8)" }}>
            Loading tasks...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "30px", color: "var(--nexo-text-secondary, #94a3b8)", fontStyle: "italic" }}>
            No tasks found in this view.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {filtered.map((todo) => (
              <div
                key={todo.id}
                onClick={() => onToggle(todo.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderRadius: "10px",
                  background: todo.completed ? "rgba(255, 255, 255, 0.02)" : "rgba(255, 255, 255, 0.05)",
                  border: `1px solid ${todo.completed ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.08)"}`,
                  cursor: "pointer",
                  transition: "all 0.2s ease"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => onToggle(todo.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ cursor: "pointer", width: "18px", height: "18px", accentColor: "#38bdf8" }}
                  />
                  <span
                    style={{
                      fontSize: "0.95rem",
                      textDecoration: todo.completed ? "line-through" : "none",
                      color: todo.completed ? "var(--nexo-text-secondary, #94a3b8)" : "var(--nexo-text-primary, #f8fafc)",
                      fontWeight: todo.completed ? 400 : 500
                    }}
                  >
                    {todo.text}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <NexoBadge variant={todo.completed ? "success" : "neutral"} size="sm">
                    {todo.completed ? "Completed" : "In Progress"}
                  </NexoBadge>
                  <span style={{ fontSize: "0.75rem", color: "var(--nexo-text-secondary, #94a3b8)" }}>
                    #{todo.id}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </NexoCard>
    );
  }
});

// ---------------------------------------------------------------------------
// NexoComp: QuickActionToolbar
// ---------------------------------------------------------------------------
export const QuickActionToolbarComp = nexoComp({
  name: "QuickActionToolbar",
  purpose: "Execution toolbar for running diagnostics, health checks, and triggering log traces",
  render: ({
    onRefreshHealth,
    onRefreshKnowledge,
    onSeedSample
  }: {
    onRefreshHealth: () => void;
    onRefreshKnowledge: () => void;
    onSeedSample: () => void;
  }) => {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          padding: "14px 20px",
          background: "rgba(255, 255, 255, 0.03)",
          borderRadius: "12px",
          border: "1px solid rgba(255, 255, 255, 0.06)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "1.1rem" }}>⚡</span>
          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Diagnostic Actions</span>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <NexoButton variant="secondary" size="sm" onClick={onRefreshHealth} icon="🔄">
            Refresh Health
          </NexoButton>
          <NexoButton variant="secondary" size="sm" onClick={onRefreshKnowledge} icon="🧠">
            Sync Knowledge
          </NexoButton>
          <NexoButton variant="glass" size="sm" onClick={onSeedSample} icon="✨">
            Add Sample Task
          </NexoButton>
        </div>
      </div>
    );
  }
});

// ---------------------------------------------------------------------------
// NexoComp: Main App Container
// ---------------------------------------------------------------------------
export const AppComp = nexoComp({
  name: "App",
  purpose: "Root page hosting multiple coordinated nexoComps with React in the background",
  render: () => {
    const [todos, setTodos] = useState<Todo[]>([]);
    const [todosLoading, setTodosLoading] = useState(true);
    const [terminalLogs, setTerminalLogs] = useState<TerminalEntry[]>([]);

    // Live hooks for Nexo knowledge and health
    const { health, refresh: refreshHealth } = useNexoHealth({ pollInterval: 5000 });
    const { knowledge, refresh: refreshKnowledge } = useNexoKnowledge({ pollInterval: 10000 });

    const addLog = (level: TerminalEntry["level"], source: string, message: string, payload?: unknown) => {
      const entry: TerminalEntry = {
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        payload
      };
      setTerminalLogs((prev) => [...prev.slice(-100), entry]);
    };

    // Load initial todos
    const loadTodos = async () => {
      try {
        addLog("info", "HTTP", "GET /api/todos requesting tasks list");
        const list = await nexo.get<Todo[]>("/api/todos");
        setTodos(list);
        addLog("success", "HTTP", `Loaded ${list.length} tasks from backend`);
      } catch (err) {
        addLog("error", "HTTP", "Failed to fetch todos", err);
      } finally {
        setTodosLoading(false);
      }
    };

    useEffect(() => {
      loadTodos();
      addLog("info", "System", "Nexo studio initialized with React in background and nexoComp UI layer");
    }, []);

    // Handlers
    const handleAddTodo = async (taskText: string) => {
      try {
        addLog("info", "HTTP", `POST /api/todos: creating task "${taskText}"`);
        const created = await nexo.post<Todo>("/api/todos", { text: taskText });
        setTodos((prev) => [...prev, created]);
        addLog("success", "DSC", `Task #${created.id} created and DAG state updated`);
      } catch (err) {
        addLog("error", "HTTP", "Failed to add todo", err);
      }
    };

    const handleToggleTodo = async (id: number) => {
      try {
        addLog("info", "HTTP", `POST /api/todos/${id}/toggle`);
        const updated = await nexo.post<Todo>(`/api/todos/${id}/toggle`);
        setTodos((prev) => prev.map((t) => (t.id === id ? updated : t)));
        addLog("success", "DSC", `Task #${id} toggled to ${updated.completed ? "completed" : "pending"}`);
      } catch (err) {
        addLog("error", "HTTP", `Failed to toggle todo #${id}`, err);
      }
    };

    const handleSeedSample = () => {
      const sampleIdeas = [
        "Optimize module dependency resolution with DAG",
        "Enable LRU cache for pure nexoComp renderers",
        "Activate token deduplication interceptor",
        "Verify Radix Trie sub-millisecond route lookup"
      ];
      const randomIdea = sampleIdeas[Math.floor(Math.random() * sampleIdeas.length)]!;
      handleAddTodo(randomIdea);
    };

    const isOnline = health?.status === "ok";

    // Tab content configurations
    const tabs = [
      {
        id: "workspace",
        label: "Interactive Workspace",
        icon: <span>⚡</span>,
        badge: <NexoBadge variant="cyan" size="sm">{todos.length}</NexoBadge>,
        content: (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            <QuickActionToolbarComp
              onRefreshHealth={() => {
                refreshHealth();
                addLog("info", "System", "Manual health refresh dispatched");
              }}
              onRefreshKnowledge={() => {
                refreshKnowledge();
                addLog("info", "System", "Manual knowledge sync dispatched");
              }}
              onSeedSample={handleSeedSample}
            />

            <TodoManagerComp
              todos={todos}
              loading={todosLoading}
              onAdd={handleAddTodo}
              onToggle={handleToggleTodo}
            />

            <NexoTerminal
              title="Nexo Live Telemetry & DSC Console"
              entries={terminalLogs}
              maxHeight={260}
              onClear={() => setTerminalLogs([])}
            />
          </div>
        )
      },
      {
        id: "architecture",
        label: "Module DAG Graph",
        icon: <span>🧩</span>,
        badge: <NexoBadge variant="purple" size="sm">{health?.moduleGraph?.length ?? 0}</NexoBadge>,
        content: (
          <NexoCard
            title="Monorepo Module Graph & Dependencies"
            subtitle="Live introspection of upstream dependencies and downstream dependents registered in Nexo"
            icon="🌐"
          >
            <NexoModuleGraph modules={health?.moduleGraph ?? []} />
          </NexoCard>
        )
      },
      {
        id: "knowledge",
        label: "Knowledge Journal & ADRs",
        icon: <span>🧠</span>,
        badge: (
          <NexoBadge variant="success" size="sm">
            {(knowledge?.decisions?.length ?? 0) + (knowledge?.constraints?.length ?? 0)}
          </NexoBadge>
        ),
        content: (
          <NexoKnowledgeInspector
            knowledge={knowledge}
            moduleGraph={health?.moduleGraph}
          />
        )
      }
    ];

    return (
      <NexoPage
        navbar={<NavbarComp uptimeSeconds={health?.uptimeSeconds} isOnline={isOnline} />}
        title="Fullstack Nexo Dashboard"
        subtitle="Seamless reactive UI where React powers rendering behind the scenes, and every block is a nexoComp"
        statusBadge={
          <NexoBadge variant="cyan" pulse>
            Live DSA Optimization
          </NexoBadge>
        }
        actions={
          <div style={{ display: "flex", gap: "8px" }}>
            <NexoButton
              variant="secondary"
              size="sm"
              onClick={() => {
                addLog("info", "Benchmark", "Triggering DSC diagnostic ping");
                refreshHealth();
              }}
            >
              Ping Server
            </NexoButton>
          </div>
        }
      >
        <NexoServerStatus health={health} />

        <KpiMetricsGridComp
          totalTodos={todos.length}
          completedTodos={todos.filter((t) => t.completed).length}
          moduleCount={health?.moduleGraph?.length ?? health?.modules?.length ?? 0}
          uptime={health?.uptimeSeconds ?? 0}
        />

        <NexoTabs tabs={tabs} defaultTabId="workspace" />
      </NexoPage>
    );
  }
});

export const App = AppComp;
