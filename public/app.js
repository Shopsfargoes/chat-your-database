// public/app.js
const dbTypeSelect = document.getElementById("db_type");
const portInput = document.getElementById("port");
const form = document.getElementById("connect-form");
const statusMsg = document.getElementById("status-msg");
const connectBtn = document.getElementById("connect-btn");

// Auto-update default port when database type changes
dbTypeSelect.addEventListener("change", () => {
  portInput.value = dbTypeSelect.value === "mysql" ? "3306" : "5432";
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  connectBtn.disabled = true;
  statusMsg.textContent = "Testing database connection and reading schema...";

  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  payload.port = Number(payload.port);
  payload.ssl = formData.get("ssl") === "on";

  try {
    const res = await fetch("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Connection failed");

    localStorage.setItem("workspace_id", data.workspaceId);
    statusMsg.textContent = `Connected! Found ${data.tableCount} tables.`;
  } catch (err) {
    statusMsg.textContent = `Error: ${err.message}`;
  } finally {
    connectBtn.disabled = false;
  }
});