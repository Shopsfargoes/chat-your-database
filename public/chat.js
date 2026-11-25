const params = new URLSearchParams(window.location.search);
let activeWorkspaceId =
  params.get("workspaceId") || localStorage.getItem("workspace_id") || "";

const workspaceSelect = document.getElementById("workspace-select");
const deleteWorkspaceBtn = document.getElementById("delete-workspace-btn");
const workspaceBadge = document.getElementById("workspace-badge");
const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("question-input");
const sendBtn = document.getElementById("send-btn");
const chipsBar = document.getElementById("suggestion-chips");

const history = [];

function buildExampleQuestions(tables) {
  if (!Array.isArray(tables) || tables.length === 0) return [];

  const questions = [];
  for (const table of tables.slice(0, 4)) {
    const readable = table.replace(/[_-]+/g, " ");
    questions.push(`How many ${readable} are there in total?`);
    questions.push(`Show the 10 most recent rows from ${table}`);
  }
  return questions.slice(0, 6);
}

function setChipsDisabled(disabled) {
  if (!chipsBar) return;
  chipsBar.querySelectorAll("button.chip-btn").forEach((btn) => {
    btn.disabled = disabled;
  });
}

function renderSuggestionChips(questions) {
  if (!chipsBar) return;
  chipsBar.innerHTML = "";

  for (const q of questions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn";
    btn.textContent = q;
    btn.addEventListener("click", () => {
      if (sendBtn.disabled) return;
      inputEl.value = q;
      formEl.requestSubmit();
    });
    chipsBar.appendChild(btn);
  }
}

async function loadSuggestionChips(id) {
  if (!chipsBar) return;
  if (!id) {
    chipsBar.innerHTML = "";
    return;
  }

  try {
    const res = await fetch(`/api/workspace-schema?workspaceId=${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load schema tables");
    renderSuggestionChips(buildExampleQuestions(data.tables));
  } catch {
    chipsBar.innerHTML = "";
  }
}

function setActiveWorkspace(id, labelText = "") {
  activeWorkspaceId = id || "";
  if (activeWorkspaceId) {
    localStorage.setItem("workspace_id", activeWorkspaceId);
    const url = new URL(window.location.href);
    url.searchParams.set("workspaceId", activeWorkspaceId);
    window.history.replaceState({}, "", url);
    workspaceBadge.textContent = labelText || `Workspace: ${activeWorkspaceId}`;
    if (deleteWorkspaceBtn) deleteWorkspaceBtn.disabled = false;
  } else {
    localStorage.removeItem("workspace_id");
    workspaceBadge.textContent = "Workspace: none selected — open DB Settings first";
    if (deleteWorkspaceBtn) deleteWorkspaceBtn.disabled = true;
  }
  history.length = 0;
  loadSuggestionChips(activeWorkspaceId);
}

async function loadWorkspaces() {
  if (!workspaceSelect) return;

  try {
    const res = await fetch("/api/workspaces");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load workspaces");

    const list = Array.isArray(data.workspaces) ? data.workspaces : [];
    workspaceSelect.innerHTML = "";

    if (list.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No connected databases";
      workspaceSelect.appendChild(opt);
      setActiveWorkspace("");
      return;
    }

    for (const ws of list) {
      const opt = document.createElement("option");
      opt.value = ws.id;
      const modelInfo = ws.ai_model ? `${ws.ai_provider}/${ws.ai_model}` : ws.ai_provider;
      opt.textContent = `${ws.name} (${ws.db_type} · ${modelInfo})`;
      workspaceSelect.appendChild(opt);
    }

    const matched = list.find((w) => w.id === activeWorkspaceId) || list[0];
    workspaceSelect.value = matched.id;
    const modelLabel = matched.ai_model ? `${matched.ai_provider}/${matched.ai_model}` : matched.ai_provider;
    setActiveWorkspace(matched.id, `${matched.name} · ${matched.db_type.toUpperCase()} · ${modelLabel}`);
  } catch (err) {
    workspaceSelect.innerHTML = `<option value="">Error loading workspaces</option>`;
    workspaceBadge.textContent = err.message || "Could not load workspaces";
  }
}

workspaceSelect?.addEventListener("change", () => {
  const selectedId = workspaceSelect.value;
  const selectedText = workspaceSelect.options[workspaceSelect.selectedIndex]?.textContent || "";
  setActiveWorkspace(selectedId, selectedText);
  if (selectedId) {
    appendAssistantResponse({
      answer: `Switched workspace to ${selectedText}.`,
    });
  }
});

deleteWorkspaceBtn?.addEventListener("click", async () => {
  if (!activeWorkspaceId) return;

  const currentLabel =
    workspaceSelect?.options[workspaceSelect.selectedIndex]?.textContent || activeWorkspaceId;
  const confirmed = window.confirm(
    `Delete workspace "${currentLabel}"? Its encrypted credentials and schema config will be removed.`
  );
  if (!confirmed) return;

  deleteWorkspaceBtn.disabled = true;
  deleteWorkspaceBtn.textContent = "Deleting...";

  try {
    const res = await fetch(`/api/workspace?id=${encodeURIComponent(activeWorkspaceId)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to delete workspace");

    activeWorkspaceId = "";
    await loadWorkspaces();

    appendAssistantResponse({
      answer: `Deleted workspace "${currentLabel}".`,
    });
  } catch (err) {
    appendAssistantResponse({
      answer: err.message || "Could not delete workspace.",
      isError: true,
    });
  } finally {
    deleteWorkspaceBtn.textContent = "Delete";
    deleteWorkspaceBtn.disabled = !activeWorkspaceId;
  }
});

function appendUserMessage(text) {
  const card = document.createElement("div");
  card.className = "message user";

  const p = document.createElement("p");
  p.className = "answer";
  p.textContent = text;

  card.appendChild(p);
  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatCellValue(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function escapeCsvCell(raw) {
  let str = String(raw);
  // Neutralize leading spreadsheet formula characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Escape double quotes and wrap in quotes if needed
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(rows, columns) {
  const headerLine = columns.map(escapeCsvCell).join(",");
  const dataLines = rows.map((row) =>
    columns.map((col) => escapeCsvCell(formatCellValue(row?.[col]))).join(",")
  );
  return [headerLine, ...dataLines].join("\r\n");
}

function downloadCsvFile(csvContent, filename = "query-results.csv") {
  // UTF-8 BOM helps Excel open non-ASCII characters cleanly
  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Delay revoking so browser download starts cleanly
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildResultTable(rows) {
  const container = document.createElement("div");
  container.className = "result-table-block";

  const columns = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row || {}).forEach((k) => keys.add(k));
      return keys;
    }, new Set())
  );

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "csv-btn";
  exportBtn.textContent = "Download CSV";
  exportBtn.addEventListener("click", () => {
    const csv = rowsToCsv(rows, columns);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsvFile(csv, `query-results-${stamp}.csv`);
  });
  container.appendChild(exportBtn);

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";

  const table = document.createElement("table");
  table.className = "results-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      const val = row?.[col];
      td.textContent =
        val === null || val === undefined
          ? "NULL"
          : typeof val === "object"
            ? JSON.stringify(val)
            : String(val);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  container.appendChild(wrap);
  return container;
}

function appendAssistantResponse({ answer, sql, rowCount, rows, isError = false }) {
  const card = document.createElement("div");
  card.className = "message assistant";

  const answerP = document.createElement("p");
  answerP.className = "answer";
  answerP.textContent = answer;
  if (isError) {
    answerP.style.color = "#fca5a5";
  }
  card.appendChild(answerP);

  if (sql) {
    const details = document.createElement("details");
    details.className = "sql-details";
    details.open = true;

    const summary = document.createElement("summary");
    summary.textContent = "Executed SQL";
    details.appendChild(summary);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = sql;
    pre.appendChild(code);
    details.appendChild(pre);

    card.appendChild(details);
  }

  if (Array.isArray(rows) && rows.length > 0) {
    const meta = document.createElement("div");
    meta.className = "table-meta";
    meta.textContent = `Showing ${rows.length} row(s)${
      typeof rowCount === "number" && rowCount !== rows.length ? ` of ${rowCount}` : ""
    }`;
    card.appendChild(meta);
    card.appendChild(buildResultTable(rows));
  } else if (!isError && Array.isArray(rows)) {
    const meta = document.createElement("div");
    meta.className = "table-meta";
    meta.textContent = "0 rows returned.";
    card.appendChild(meta);
  }

  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = inputEl.value.trim();
  if (!question) return;

  if (!activeWorkspaceId) {
    appendAssistantResponse({
      answer: "No workspace ID found. Go to DB Settings and connect a database first.",
      isError: true,
    });
    return;
  }

  appendUserMessage(question);
  inputEl.value = "";
  inputEl.disabled = true;
  sendBtn.disabled = true;
  setChipsDisabled(true);

  const loadingCard = document.createElement("div");
  loadingCard.className = "message assistant";
  loadingCard.innerHTML = `<p class="answer">Generating SQL and querying database...</p>`;
  messagesEl.appendChild(loadingCard);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: activeWorkspaceId,
        question,
        history,
      }),
    });

    const data = await res.json();
    loadingCard.remove();

    if (!res.ok) {
      throw new Error(data.error || "Query failed");
    }

    history.push({ role: "user", content: question });
    history.push({ role: "assistant", content: `${data.answer}\nSQL: ${data.sql || ""}` });

    appendAssistantResponse({
      answer: data.answer,
      sql: data.sql,
      rowCount: data.rowCount,
      rows: data.rows,
    });
  } catch (err) {
    loadingCard.remove();
    appendAssistantResponse({
      answer: err.message || "Something went wrong.",
      isError: true,
    });
  } finally {
    inputEl.disabled = false;
    sendBtn.disabled = false;
    setChipsDisabled(false);
    inputEl.focus();
  }
});

const refreshSchemaBtn = document.getElementById("refresh-schema-btn");

if (refreshSchemaBtn) {
  refreshSchemaBtn.addEventListener("click", async () => {
    if (!activeWorkspaceId) {
      appendAssistantResponse({
        answer: "No workspace ID found. Open DB Settings first.",
        isError: true,
      });
      return;
    }

    refreshSchemaBtn.disabled = true;
    refreshSchemaBtn.textContent = "Refreshing...";

    try {
      const res = await fetch("/api/refresh-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: activeWorkspaceId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Schema refresh failed");

      await loadSuggestionChips(activeWorkspaceId);

      appendAssistantResponse({
        answer: `Schema refreshed for "${data.name}". Found ${data.tableCount} table(s).`,
      });
    } catch (err) {
      appendAssistantResponse({
        answer: err.message || "Could not refresh schema.",
        isError: true,
      });
    } finally {
      refreshSchemaBtn.disabled = false;
      refreshSchemaBtn.textContent = "Refresh Schema";
    }