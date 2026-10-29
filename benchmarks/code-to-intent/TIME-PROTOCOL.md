# Time to a working feature, and time to find and fix a mistake

How to measure how long people take with Nexo's lower-level APIs (**before**) and with
`serve()`/`resource()`/`model()` (**after**). This needs people, so no results are recorded
yet. What the framework *tells* a developer is measured automatically in
[DEBUGGING.md](./DEBUGGING.md); lines of code and concepts are in [RESULTS.md](./RESULTS.md).

## What is measured

| Measure | Definition |
|---|---|
| **Working** | The task's conformance tests pass (`test/conformance.test.js`, the same tests both code-to-intent variants pass). The recorder's `verify` runs them; nobody judges "done" by eye. |
| **Active time** | From `start` to the first passing `verify`, minus breaks (`pause` … `resume`). |
| **Elapsed time** | From `start` to the first passing `verify`, breaks included. |
| **Time to the cause** (debug tasks) | Active time until the participant records what they think is wrong (`found`). The report shows how many of those were right. |
| **Verify runs** | How many checks it took; a rough measure of trial and error. |

## Tasks

Defined in [time/tasks.mjs](./time/tasks.mjs):

- **Feature tasks:** `user-crud`, `product-search`, `relationship`, `authentication`,
  `file-upload`, `app-startup`. The variant's files are replaced by stubs that keep their
  exports; the participant writes them until the conformance tests pass.
- **Debug tasks:** the variant's working code with one mistake put in.
  `debug-wrong-scope` is an authorization mistake: a write scope is misspelled.
  `debug-field-typo` is a field name misspelled where the shape of a user is declared (the
  schema before, the model after). The participant finds the cause, records it, and fixes it.

Each task is the same work in both variants and is checked by the same tests.

## Participants and assignment

- At least **5 sessions per task and variant** before reporting medians; report the number of
  sessions next to every median. With fewer, report each session.
- **Each participant does a task in one variant only.** Doing it twice teaches the task.
- **Counterbalance:** half the participants get *before* for a given task, half *after*;
  shuffle the order of tasks per participant.
- Record each participant's experience with Node.js, TypeScript and Nexo (none, some, a lot),
  and report results split by it if the groups differ.
- Same machine setup for everyone: this repository, built (`pnpm build`), Node 22.5 or later.

## Running a session

From `benchmarks/code-to-intent`, after `pnpm build` at the repository root:

```bash
node time/record.mjs prepare <participant> <task> <before|after>
#   → prints a session id and a folder under .nexo-time-sessions/ (git-ignored)
node time/record.mjs start <session>       # when the participant starts reading the task
node time/record.mjs pause <session>       # breaks only; resume afterwards
node time/record.mjs resume <session>
node time/record.mjs found <session> "<the cause, in their words>"   # debug tasks
node time/record.mjs verify <session>      # as often as they like; the first pass ends the session
node time/record.mjs report                # medians per task and variant, as a table
```

Events go to `time/results.jsonl`, one per line. Keep it with the results, together with
the participant notes.

**What participants get:** the task description below, the folder, `docs/primitives.md` and
the package READMEs. Decide before the study whether AI assistants are allowed, and record it;
don't mix sessions with and without them in one median.

**Task descriptions to read out:**

- Feature tasks: "Make the tests for this feature pass by writing the files in
  `src/<feature>/<variant>/`. The other variant's folder and `test/conformance.test.js` show what
  is expected; don't copy the other variant's code for this one."
- Debug tasks: "This feature worked yesterday and its tests fail now. Find out why, record the
  cause with `found`, and fix it."

## Reading the results

- Compare medians per task, with the session counts; don't add tasks together.
- A difference smaller than the spread between participants in one variant isn't a difference.
- The variants differ in more than syntax: **after** also does things **before** doesn't (see
  RESULTS.md), so a feature can take as long while delivering more.
- Not covered: large, unfamiliar codebases; production incidents; time spent learning Nexo
  itself beyond the docs given.
