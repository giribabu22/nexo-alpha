import test from "node:test";
import assert from "node:assert/strict";
import {
  NexoLruCache,
  NexoRadixTrie,
  NexoElementGraph
} from "../dist/index.js";

test("NexoLruCache evicts least-recently-used items when capacity is reached", () => {
  const cache = new NexoLruCache(3);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);

  assert.equal(cache.size, 3);
  assert.equal(cache.get("a"), 1); // "a" is accessed, so "b" is now LRU

  cache.set("d", 4); // should evict "b"
  assert.equal(cache.size, 3);
  assert.equal(cache.get("b"), undefined); // evicted
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.get("d"), 4);
});

test("NexoRadixTrie matches exact, parameterized, and wildcard paths", () => {
  const trie = new NexoRadixTrie();
  trie.insert("/", "home");
  trie.insert("/todos", "todo-list");
  trie.insert("/todos/:id", "todo-detail");
  trie.insert("/todos/:id/edit", "todo-edit");
  trie.insert("/docs/*", "docs-catchall");

  // Exact match
  const m1 = trie.match("/");
  assert.ok(m1);
  assert.equal(m1.route, "home");

  const m2 = trie.match("/todos");
  assert.ok(m2);
  assert.equal(m2.route, "todo-list");

  // Parameter match
  const m3 = trie.match("/todos/42");
  assert.ok(m3);
  assert.equal(m3.route, "todo-detail");
  assert.equal(m3.params.id, "42");

  const m4 = trie.match("/todos/99/edit");
  assert.ok(m4);
  assert.equal(m4.route, "todo-edit");
  assert.equal(m4.params.id, "99");

  // Wildcard match
  const m5 = trie.match("/docs/architecture/dsa");
  assert.ok(m5);
  assert.equal(m5.route, "docs-catchall");
  assert.equal(m5.params["*"], "architecture/dsa");

  // No match
  assert.equal(trie.match("/nonexistent/route"), null);
});

test("NexoElementGraph tracks parent-child hierarchy and propagates dirty flags", () => {
  const graph = new NexoElementGraph();

  // Construct component tree:
  // Root -> Header
  //      -> TodoApp -> TodoInput
  //                 -> TodoList -> TodoItem
  graph.addNode("root", "Root", 0);
  graph.addNode("header", "Header", 1);
  graph.addNode("todoApp", "TodoApp", 1);
  graph.addNode("todoInput", "TodoInput", 2);
  graph.addNode("todoList", "TodoList", 2);
  graph.addNode("todoItem1", "TodoItem", 3);

  graph.addEdge("root", "header");
  graph.addEdge("root", "todoApp");
  graph.addEdge("todoApp", "todoInput");
  graph.addEdge("todoApp", "todoList");
  graph.addEdge("todoList", "todoItem1");

  // Verify relations
  assert.deepEqual([...graph.getNode("todoApp").children], ["todoInput", "todoList"]);
  assert.deepEqual([...graph.getNode("todoApp").parents], ["root"]);

  // Mark TodoList as dirty -> should propagate only to TodoItem1, not Header or TodoInput!
  const dirtySet = graph.markDirty("todoList", true);
  assert.ok(dirtySet.has("todoList"));
  assert.ok(dirtySet.has("todoItem1"));
  assert.equal(dirtySet.has("header"), false);
  assert.equal(dirtySet.has("todoInput"), false);

  // Render batch should order parents before children (topological ordering)
  const batch = graph.getRenderBatch(dirtySet);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].id, "todoList"); // depth 2
  assert.equal(batch[1].id, "todoItem1"); // depth 3
});
