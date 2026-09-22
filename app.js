const SUPABASE_URL = "https://fvigyywkoigqmzwrzvgr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_5s6yCRGS2mGFpsf3yWygIg_EeBqK_Q2";
const ADMIN_PIN_KEY = "foosballAdminPin";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const state = { players: [], games: [], refreshTimer: null, adminPin: sessionStorage.getItem(ADMIN_PIN_KEY) || null };
const el = (id) => document.getElementById(id);

function setStatus(type, text) {
  el("connectionStatus").className = `status ${type}`;
  el("connectionStatus").lastElementChild.textContent = text;
}

let toastTimer;
function toast(message, isError = false) {
  const node = el("toast");
  node.textContent = message;
  node.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

function isAdmin() { return !!state.adminPin; }

function isSetupMissing(error) {
  return error?.code === "PGRST202" || /Could not find the function/i.test(error?.message || "");
}

const ELO_START = 1000;
const ELO_K = 32;

function computeElo() {
  const ratings = new Map(state.players.map((p) => [p.id, ELO_START]));
  const deltas = new Map();
  const chronological = [...state.games].sort((a, b) => new Date(a.played_at) - new Date(b.played_at));
  chronological.forEach((game) => {
    const winnerId = game.winner_id;
    const loserId = winnerId === game.player_one_id ? game.player_two_id : game.player_one_id;
    if (!ratings.has(winnerId) || !ratings.has(loserId)) return;
    const winnerRating = ratings.get(winnerId);
    const loserRating = ratings.get(loserId);
    const expectedWinner = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    const change = Math.round(ELO_K * (1 - expectedWinner));
    ratings.set(winnerId, winnerRating + change);
    ratings.set(loserId, loserRating - change);
    deltas.set(game.id, change);
  });
  return { ratings, deltas };
}

async function loadData({ quiet = false } = {}) {
  if (!quiet) setStatus("", "Syncing…");
  const [playersResult, gamesResult] = await Promise.all([
    db.from("players").select("id,name,created_at").order("name"),
    db.from("games").select("id,player_one_id,player_two_id,winner_id,played_at").order("played_at", { ascending: false })
  ]);

  const error = playersResult.error || gamesResult.error;
  if (error) {
    console.error(error);
    setStatus("error", "Setup needed");
    toast("Could not load data. Run supabase-setup.sql first.", true);
    return;
  }

  state.players = playersResult.data || [];
  state.games = gamesResult.data || [];
  render();
  setStatus("online", "Live & synced");
}

function standings() {
  const rows = new Map(state.players.map((player) => [player.id, {
    ...player, wins: 0, losses: 0, games: 0, points: 0, winPct: 0, elo: ELO_START
  }]));

  state.games.forEach((game) => {
    const one = rows.get(game.player_one_id);
    const two = rows.get(game.player_two_id);
    if (!one || !two) return;
    one.games += 1;
    two.games += 1;
    const winner = game.winner_id === one.id ? one : two;
    const loser = game.winner_id === one.id ? two : one;
    winner.wins += 1;
    winner.points += 3;
    loser.losses += 1;
  });

  rows.forEach((row) => {
    row.winPct = row.games ? (row.wins / row.games) * 100 : 0;
    row.elo = state.eloRatings?.get(row.id) ?? ELO_START;
  });
  return [...rows.values()].sort((a, b) =>
    b.elo - a.elo || b.winPct - a.winPct || b.wins - a.wins || a.name.localeCompare(b.name)
  );
}

function renderLeaderboard(rows) {
  el("leaderboardEmpty").hidden = rows.length > 0;
  el("leaderboardBody").innerHTML = rows.map((row, index) => {
    const medal = ["🥇", "🥈", "🥉"][index] || index + 1;
    return `<tr>
      <td class="rank ${index < 3 ? "top" : ""}">${medal}</td>
      <td><div class="player-cell"><span class="avatar">${escapeHtml(row.name.charAt(0).toUpperCase())}</span>${escapeHtml(row.name)}</div></td>
      <td>${row.wins}</td><td>${row.losses}</td><td>${Math.round(row.winPct)}%</td><td class="points">${Math.round(row.elo)}</td><td>${row.points}</td>
    </tr>`;
  }).join("");
}

function renderPlayerOptions() {
  const currentOne = el("playerOne").value;
  const currentTwo = el("playerTwo").value;
  const options = state.players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  el("playerOne").innerHTML = `<option value="">Select player</option>${options}`;
  el("playerTwo").innerHTML = `<option value="">Select player</option>${options}`;
  if (state.players.some((p) => p.id === currentOne)) el("playerOne").value = currentOne;
  if (state.players.some((p) => p.id === currentTwo)) el("playerTwo").value = currentTwo;
  updateWinnerOptions();
}

function updateWinnerOptions() {
  const one = state.players.find((p) => p.id === el("playerOne").value);
  const two = state.players.find((p) => p.id === el("playerTwo").value);
  const valid = one && two && one.id !== two.id;
  el("winner").disabled = !valid;
  el("winner").innerHTML = valid
    ? `<option value="">Select winner</option><option value="${one.id}">${escapeHtml(one.name)}</option><option value="${two.id}">${escapeHtml(two.name)}</option>`
    : `<option value="">${one && two && one.id === two.id ? "Players must be different" : "Choose both players first"}</option>`;
}

function renderRoster() {
  el("rosterList").innerHTML = state.players.map((p) => `
    <div class="roster-row" data-id="${p.id}">
      <span class="roster-name">${escapeHtml(p.name)}</span>
      <span class="roster-actions">
        <button type="button" class="text-button edit-player" aria-label="Rename ${escapeHtml(p.name)}">✎</button>
        <button type="button" class="text-button delete-player" aria-label="Remove ${escapeHtml(p.name)}">🗑</button>
      </span>
    </div>`).join("");
}

function renderHistory() {
  const players = new Map(state.players.map((p) => [p.id, p.name]));
  const games = state.games.slice(0, 10);
  el("historyEmpty").hidden = games.length > 0;
  el("gameHistory").innerHTML = games.map((game) => {
    const one = players.get(game.player_one_id) || "Unknown";
    const two = players.get(game.player_two_id) || "Unknown";
    const winner = players.get(game.winner_id) || "Unknown";
    const delta = state.eloDeltas?.get(game.id);
    return `<article class="history-item" data-id="${game.id}">
      <div><span class="win-tag">WINNER</span><div class="matchup"><span class="winner-name">${escapeHtml(winner)}</span> defeated ${escapeHtml(winner === one ? two : one)}${delta != null ? ` <span class="elo-delta">+${delta} Elo</span>` : ""}</div></div>
      <div class="history-right">
        <time class="game-time" datetime="${game.played_at}">${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(game.played_at))}</time>
        <span class="history-admin-actions">
          <button type="button" class="text-button edit-game" aria-label="Edit match">✎</button>
          <button type="button" class="text-button delete-game" aria-label="Delete match">🗑</button>
        </span>
      </div>
    </article>`;
  }).join("");
}

function render() {
  const elo = computeElo();
  state.eloRatings = elo.ratings;
  state.eloDeltas = elo.deltas;
  const rows = standings();
  renderLeaderboard(rows);
  renderPlayerOptions();
  renderRoster();
  renderHistory();
  el("playerCount").textContent = state.players.length;
  el("gameCount").textContent = state.games.length;
  el("leaderName").textContent = rows[0]?.name || "—";
}

el("playerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = el("playerName");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (name.length < 2) return toast("Enter at least 2 characters.", true);
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  const { error } = await db.from("players").insert({ name });
  button.disabled = false;
  if (error) {
    const duplicate = error.code === "23505";
    return toast(duplicate ? "That player already exists." : error.message, true);
  }
  input.value = "";
  toast(`${name} joined the roster.`);
  await loadData({ quiet: true });
});

el("gameForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const playerOne = el("playerOne").value;
  const playerTwo = el("playerTwo").value;
  const winner = el("winner").value;
  if (!playerOne || !playerTwo || playerOne === playerTwo || ![playerOne, playerTwo].includes(winner)) {
    return toast("Choose two different players and the winner.", true);
  }
  const button = el("recordGameButton");
  button.disabled = true;
  const { error } = await db.from("games").insert({ player_one_id: playerOne, player_two_id: playerTwo, winner_id: winner });
  button.disabled = false;
  if (error) return toast(error.message, true);
  const winnerName = state.players.find((p) => p.id === winner)?.name || "Winner";
  event.currentTarget.reset();
  updateWinnerOptions();
  toast(`Match recorded — ${winnerName} wins!`);
  await loadData({ quiet: true });
});

el("playerOne").addEventListener("change", updateWinnerOptions);
el("playerTwo").addEventListener("change", updateWinnerOptions);
el("refreshButton").addEventListener("click", () => loadData());

// --- Admin mode -------------------------------------------------------

function setAdminUI() {
  document.body.classList.toggle("admin-mode", isAdmin());
  el("adminBadge").hidden = !isAdmin();
  const toggle = el("adminToggleButton");
  toggle.textContent = isAdmin() ? "🔓" : "🔒";
  toggle.title = isAdmin() ? "Lock admin mode" : "Unlock admin mode";
  toggle.classList.toggle("unlocked", isAdmin());
  render();
}

function openPinModal() {
  el("pinInput").value = "";
  el("pinModalBackdrop").hidden = false;
  el("pinInput").focus();
}
function closePinModal() { el("pinModalBackdrop").hidden = true; }

el("adminToggleButton").addEventListener("click", () => {
  if (isAdmin()) {
    state.adminPin = null;
    sessionStorage.removeItem(ADMIN_PIN_KEY);
    setAdminUI();
    toast("Admin mode locked.");
  } else {
    openPinModal();
  }
});

el("pinCancelButton").addEventListener("click", closePinModal);
el("pinModalBackdrop").addEventListener("click", (event) => {
  if (event.target === el("pinModalBackdrop")) closePinModal();
});

el("pinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = el("pinInput").value.trim();
  if (!pin) return;
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  const { error } = await db.rpc("admin_check_pin", { p_pin: pin });
  button.disabled = false;
  if (error) {
    if (isSetupMissing(error)) return toast("Admin editing isn't set up yet — run supabase-admin-upgrade.sql in Supabase.", true);
    return toast("Incorrect PIN.", true);
  }
  state.adminPin = pin;
  sessionStorage.setItem(ADMIN_PIN_KEY, pin);
  closePinModal();
  setAdminUI();
  toast("Admin mode unlocked.");
});

async function callAdmin(fn, params) {
  const { error } = await db.rpc(fn, { ...params, p_pin: state.adminPin });
  if (error) {
    if (isSetupMissing(error)) {
      toast("Admin editing isn't set up yet — run supabase-admin-upgrade.sql in Supabase.", true);
    } else if (/pin/i.test(error.message)) {
      state.adminPin = null;
      sessionStorage.removeItem(ADMIN_PIN_KEY);
      setAdminUI();
      toast("PIN no longer valid. Unlock again.", true);
    } else {
      toast(error.message, true);
    }
    return false;
  }
  return true;
}

async function restoreAdminSession() {
  if (!state.adminPin) return setAdminUI();
  const { error } = await db.rpc("admin_check_pin", { p_pin: state.adminPin });
  if (error) {
    state.adminPin = null;
    sessionStorage.removeItem(ADMIN_PIN_KEY);
  }
  setAdminUI();
}

// --- Roster editing -----------------------------------------------------

function startEditPlayer(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  const row = document.querySelector(`.roster-row[data-id="${id}"]`);
  row.innerHTML = `
    <input class="roster-edit-input" type="text" maxlength="32" value="${escapeHtml(player.name)}">
    <span class="roster-actions">
      <button type="button" class="text-button save-player">Save</button>
      <button type="button" class="text-button cancel-player">Cancel</button>
    </span>`;
  row.querySelector("input").focus();
}

async function submitEditPlayer(id) {
  const row = document.querySelector(`.roster-row[data-id="${id}"]`);
  const name = row.querySelector("input").value.trim().replace(/\s+/g, " ");
  if (name.length < 2) return toast("Enter at least 2 characters.", true);
  const ok = await callAdmin("admin_update_player", { p_player_id: id, p_name: name });
  if (ok) { toast("Player updated."); await loadData({ quiet: true }); }
}

async function deletePlayerFlow(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  if (!confirm(`Remove ${player.name} and all of their matches? This can't be undone.`)) return;
  const ok = await callAdmin("admin_delete_player", { p_player_id: id });
  if (ok) { toast(`${player.name} removed.`); await loadData({ quiet: true }); }
}

el("rosterList").addEventListener("click", (event) => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  if (!id) return;
  if (event.target.closest(".edit-player")) return startEditPlayer(id);
  if (event.target.closest(".cancel-player")) return renderRoster();
  if (event.target.closest(".save-player")) return submitEditPlayer(id);
  if (event.target.closest(".delete-player")) return deletePlayerFlow(id);
});

// --- Match history editing -----------------------------------------------

function playerOptionsHtml(selectedId) {
  return state.players.map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("");
}

function refreshEditWinnerOptions(id) {
  const article = document.querySelector(`.history-item[data-id="${id}"]`);
  const oneId = article.querySelector(".edit-one").value;
  const twoId = article.querySelector(".edit-two").value;
  const winnerSelect = article.querySelector(".edit-winner");
  const currentWinner = winnerSelect.value;
  const one = state.players.find((p) => p.id === oneId);
  const two = state.players.find((p) => p.id === twoId);
  if (!one || !two || one.id === two.id) {
    winnerSelect.innerHTML = `<option value="">Players must differ</option>`;
    winnerSelect.disabled = true;
    return;
  }
  winnerSelect.disabled = false;
  winnerSelect.innerHTML = `
    <option value="${one.id}" ${currentWinner === one.id ? "selected" : ""}>${escapeHtml(one.name)} wins</option>
    <option value="${two.id}" ${currentWinner === two.id ? "selected" : ""}>${escapeHtml(two.name)} wins</option>`;
}

function startEditGame(id) {
  const game = state.games.find((g) => g.id === id);
  if (!game) return;
  const article = document.querySelector(`.history-item[data-id="${id}"]`);
  article.classList.add("editing");
  article.innerHTML = `
    <div class="edit-game-form">
      <select class="edit-one">${playerOptionsHtml(game.player_one_id)}</select>
      <span class="versus">VS</span>
      <select class="edit-two">${playerOptionsHtml(game.player_two_id)}</select>
      <select class="edit-winner">
        <option value="${game.player_one_id}" ${game.winner_id === game.player_one_id ? "selected" : ""}>${escapeHtml(state.players.find((p) => p.id === game.player_one_id)?.name || "")} wins</option>
        <option value="${game.player_two_id}" ${game.winner_id === game.player_two_id ? "selected" : ""}>${escapeHtml(state.players.find((p) => p.id === game.player_two_id)?.name || "")} wins</option>
      </select>
      <span class="history-admin-actions">
        <button type="button" class="text-button save-game">Save</button>
        <button type="button" class="text-button cancel-game">Cancel</button>
      </span>
    </div>`;
}

async function submitEditGame(id) {
  const article = document.querySelector(`.history-item[data-id="${id}"]`);
  const oneId = article.querySelector(".edit-one").value;
  const twoId = article.querySelector(".edit-two").value;
  const winnerId = article.querySelector(".edit-winner").value;
  if (!oneId || !twoId || oneId === twoId || ![oneId, twoId].includes(winnerId)) {
    return toast("Choose two different players and a winner.", true);
  }
  const ok = await callAdmin("admin_update_game", {
    p_game_id: id, p_player_one_id: oneId, p_player_two_id: twoId, p_winner_id: winnerId
  });
  if (ok) { toast("Match updated."); await loadData({ quiet: true }); }
}

async function deleteGameFlow(id) {
  if (!confirm("Delete this match? This can't be undone.")) return;
  const ok = await callAdmin("admin_delete_game", { p_game_id: id });
  if (ok) { toast("Match deleted."); await loadData({ quiet: true }); }
}

el("gameHistory").addEventListener("click", (event) => {
  const id = event.target.closest("[data-id]")?.dataset.id;
  if (!id) return;
  if (event.target.closest(".edit-game")) return startEditGame(id);
  if (event.target.closest(".cancel-game")) return renderHistory();
  if (event.target.closest(".save-game")) return submitEditGame(id);
  if (event.target.closest(".delete-game")) return deleteGameFlow(id);
});

el("gameHistory").addEventListener("change", (event) => {
  if (event.target.matches(".edit-one, .edit-two")) {
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (id) refreshEditWinnerOptions(id);
  }
});

function scheduleRefresh() {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => loadData({ quiet: true }), 200);
}

db.channel("foosball-live")
  .on("postgres_changes", { event: "*", schema: "public", table: "players" }, scheduleRefresh)
  .on("postgres_changes", { event: "*", schema: "public", table: "games" }, scheduleRefresh)
  .subscribe((status) => {
    if (status === "SUBSCRIBED") setStatus("online", "Live & synced");
    if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) setStatus("error", "Refresh to sync");
  });

loadData();
restoreAdminSession();
