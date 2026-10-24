# Comparisons

## Scope

How a CLI's comparison page (`docs/compare.md`) is written: which tools it compares, which rows it has, how a mark is
proven, and what it says about the places where another tool is better. The page is read by someone choosing a tool
for a job, not by someone reviewing our code.

Rule ids on this page are `WC-CMP-<n>`. How to read a rule, how ids work and which rule wins are in the
[index](README.md). The general rules for user pages are in [Documents](docs.md).

## Rules

### WC-CMP-1 · Compare with the tools a reader would pick instead, for the same job

- **Why:** a table against products in another category answers a question nobody asked and makes us look either
  better or worse than we are.
- **Enforced by:** review only.
- **Example:** zm is compared with other command lines and MCP servers for a Zoom account. Meeting assistants that
  join calls (Otter, Fireflies) are a different job; that comparison stays private until zm does that job too.
- **Exceptions:** one column may be the official app or the official API, when readers would otherwise use it.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-2 · A row is a task the user wants done, grouped by how people use the tool

- **Why:** people choose a tool by what they can do with it: read and send messages, send photos, find a chat, find a
  file, keep a draft, see who is active in a group. How login works or where data is stored is rarely the reason.
- **Enforced by:** review only.
- **Example:** groups such as "Catch up", "Reply and send", "Find", "Files and media", "Organise", "Overview and
  analytics", "Agents and safety", "Setup". Rows such as "Send several photos as one album", "Find a file someone sent
  in any chat". Not rows such as "QR login and two-step password" or "Works without a local copy".
- **Exceptions:** an implementation detail gets a row only when it changes what the user can do, such as "Search
  without internet".
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-3 · A missing feature gets a row only if users would choose a tool by it

- **Why:** a row we fail reads as a gap to fix. A rare account setting listed as missing makes the product look
  incomplete for no reason.
- **Enforced by:** review only.
- **Example:** "Set or remove the cloud password" is not a row on max's page. "Drafts" is.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-4 · Write each row so that ❌ cannot be misread

- **Why:** a short noun can name a bigger thing than the row means; with ❌ beside it the reader concludes the tool
  cannot do the bigger thing.
- **Enforced by:** review only.
- **Example:** "Show the other person that you are typing", not "Typing". ❌ beside "Typing" reads as "cannot send
  messages".
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-5 · Every page has an "Agents and safety" group, and it may be the largest

- **Why:** it is what the WireCat tools are built for, and what a reader cannot learn from a feature list: what an
  agent may do without asking, how a wrong send is stopped, what the agent sees.
- **Enforced by:** review only.
- **Example:** rows such as "An agent can read but not send unless you allow it", "Ask before each send", "Limit sends
  to a list of chats", "A send is never made twice after a retry", "Every command reachable through MCP", "Works with
  an agent without a browser".
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-6 · Keep technical rows few, and only where they help a choice

- **Why:** a reader who wants protocol details reads the docs; a comparison full of them hides the answer.
- **Enforced by:** review only.
- **Example:** one "Setup" group: install command, platforms, licence, price, MCP over stdio or HTTP, and how the tool
  compares with a browser agent driving the web app (speed, cost, reliability).
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-7 · Say plainly where another tool is better

- **Why:** a table that only shows our wins is not believed, and a reader who finds the gap later stops trusting the
  rest.
- **Enforced by:** review only.
- **Example:** a section "Where another tool fits better" with two to four scenarios, each one sentence: the job, the
  tool that does it better, why. Only gaps a reader would care about (WC-CMP-3).
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

### WC-CMP-8 · No "better" or "faster" without a published measurement

- **Why:** a quality claim against another tool is the claim a reader is most likely to test.
- **Enforced by:** review only.
- **Example:** "memo finds better answers than Hindsight" needs a result in cli-testing `performance/` and a link to
  it. Without one, the row says what each tool does ("search by words and by meaning"), not which does it better.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** none.

### WC-CMP-9 · Every mark is proven, and the page says when it was checked

- **Why:** a comparison goes stale faster than any other page, and a wrong mark about another project is unfair to
  it.
- **Enforced by:** review only.
- **Example:** our marks are checked against the code on `main` or by running the tool. A competitor mark links to
  its own documentation or source. A mark that cannot be proven is ➖ ("not in its documentation"). The intro names the
  check date. The legend is ✅ yes · 🟡 partly · ❌ no · ➖ not in its documentation.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** none.

### WC-CMP-10 · Keep the table short enough to read

- **Why:** past about 25 rows the reader stops scanning, and the rows that matter are lost.
- **Enforced by:** review only.
- **Example:** 15 to 25 rows and 3 to 6 tools. A row where every tool has the same mark is dropped.
- **Exceptions:** none.
- **Applies to:** all CLIs. **Since:** cli-base 0.50.4. **Rulings:** owner, 2026-10-24.

## Sources

- Owner review of the max, zm and memo comparison pages, 2026-10-24.
- The tg comparison page, `tg-cli/docs/compare.md`, the first page written this way.
