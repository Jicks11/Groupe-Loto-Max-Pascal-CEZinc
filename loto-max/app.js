const SELECTED_MEMBER_KEY = "equipe-b-loto-selected-member";
const ADMIN_PIN_KEY = "equipe-b-loto-admin-pin";
const REFRESH_INTERVAL_MS = 10000;

const els = {
  lastUpdated: document.querySelector("#lastUpdated"),
  nextDrawStatus: document.querySelector("#nextDrawStatus"),
  drawMeterFill: document.querySelector("#drawMeterFill"),
  drawMeterText: document.querySelector("#drawMeterText"),
  groupWins: document.querySelector("#groupWins"),
  winsCoverage: document.querySelector("#winsCoverage"),
  participantTotal: document.querySelector("#participantTotal"),
  groupTotal: document.querySelector("#groupTotal"),
  drawTotal: document.querySelector("#drawTotal"),
  drawFormula: document.querySelector("#drawFormula"),
  activeCount: document.querySelector("#activeCount"),
  participantList: document.querySelector("#participantList"),
  detailTitle: document.querySelector("#detailTitle"),
  detailStatus: document.querySelector("#detailStatus"),
  memberDetail: document.querySelector("#memberDetail"),
  groupHistory: document.querySelector("#groupHistory"),
  form: document.querySelector("#transactionForm"),
  participantForm: document.querySelector("#participantForm"),
  transactionType: document.querySelector("#transactionType"),
  participantField: document.querySelector("#participantField"),
  participantSelect: document.querySelector("#participantSelect"),
  amountInput: document.querySelector("#amountInput"),
  dateInput: document.querySelector("#dateInput"),
  paymentMode: document.querySelector("#paymentMode"),
  noteInput: document.querySelector("#noteInput"),
  applyDraw: document.querySelector("#applyDraw"),
  newParticipantName: document.querySelector("#newParticipantName"),
  newParticipantBalance: document.querySelector("#newParticipantBalance"),
  newParticipantPaymentMode: document.querySelector("#newParticipantPaymentMode"),
  newParticipantActive: document.querySelector("#newParticipantActive"),
  adminToggle: document.querySelector("#adminToggle"),
  adminLocked: document.querySelector("#adminLocked"),
  adminContent: document.querySelector("#adminContent"),
  resetDemo: document.querySelector("#resetDemo"),
  adminNote: document.querySelector("#adminNote"),
  toast: document.querySelector("#toast")
};

let state = null;
let selectedId = localStorage.getItem(SELECTED_MEMBER_KEY);
let adminUnlocked = false;

function money(value) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function dateLabel(isoDate) {
  if (!isoDate) return "Date inconnue";
  return new Date(`${String(isoDate).slice(0, 10)}T12:00:00`).toLocaleDateString("fr-CA", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function dateTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Derniere mise a jour: inconnue";
  }

  const weekdays = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
  const months = [
    "Janvier",
    "Fevrier",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Aout",
    "Septembre",
    "Octobre",
    "Novembre",
    "Decembre"
  ];
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `Derniere mise a jour: ${weekdays[date.getDay()]} le ${date.getDate()} ${months[date.getMonth()]} a ${hour}h${minute}`;
}

function signedMoney(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `+${money(amount)}` : money(amount);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Erreur serveur.");
  }
  return payload;
}

async function loadState({ silent = false } = {}) {
  try {
    state = await api("/api/state");
    if (!selectedId || !state.participants.some((participant) => participant.id === selectedId)) {
      selectedId = state.participants.at(-1)?.id || state.participants[0]?.id;
    }
    render();
  } catch (error) {
    if (!silent) {
      showToast(`Impossible de charger les donnees: ${error.message}`);
    }
  }
}

function getAdminPin() {
  const saved = sessionStorage.getItem(ADMIN_PIN_KEY);
  if (saved) return saved;

  const entered = window.prompt("PIN admin");
  if (!entered) {
    throw new Error("Action annulee.");
  }

  sessionStorage.setItem(ADMIN_PIN_KEY, entered);
  return entered;
}

async function unlockAdmin() {
  try {
    const pin = getAdminPin();
    await api("/api/admin/check", {
      method: "POST",
      body: JSON.stringify({ adminPin: pin })
    });
    adminUnlocked = true;
    renderAdminMode();
    showToast("Mode admin active.");
  } catch (error) {
    sessionStorage.removeItem(ADMIN_PIN_KEY);
    showToast(error.message);
  }
}

function renderAdminMode() {
  els.adminLocked.classList.toggle("hidden", adminUnlocked);
  els.adminContent.classList.toggle("hidden", !adminUnlocked);
  els.adminToggle.textContent = adminUnlocked ? "Admin actif" : "Mode admin";
}

function getSelectedParticipant() {
  return state?.participants.find((participant) => participant.id === selectedId) || state?.participants[0];
}

function render() {
  if (!state) return;
  renderSelectors();
  renderMetrics();
  renderParticipants();
  renderMemberDetail();
  renderGroupHistory();
  renderAdminMode();
}

function renderSelectors() {
  const currentValue = els.participantSelect.value || selectedId;
  els.participantSelect.innerHTML = state.participants
    .map((participant) => `<option value="${escapeHtml(participant.id)}">${escapeHtml(participant.name)}</option>`)
    .join("");
  els.participantSelect.value = currentValue;

  const isGroupGain = els.transactionType.value === "gain";
  els.participantField.style.display = isGroupGain ? "none" : "grid";
  if (isGroupGain) {
    els.paymentMode.value = "Billet gratuit";
  }
}

function renderMetrics() {
  const coverageRatio = state.drawTotal > 0 ? Math.min(state.groupWins / state.drawTotal, 1) : 0;
  const lastUpdated = new Date(state.lastUpdatedAt);

  els.groupWins.textContent = money(state.groupWins);
  els.winsCoverage.textContent = state.paidDraws === 1 ? "1 tirage couvert" : `${state.paidDraws} tirages couverts`;
  els.participantTotal.textContent = money(state.participantTotal);
  els.groupTotal.textContent = money(state.groupTotal);
  els.drawTotal.textContent = money(state.drawTotal);
  els.drawFormula.textContent = `${state.participants.filter((participant) => participant.active).length} x ${money(state.drawCostPerParticipant)}`;
  els.activeCount.textContent = `${state.participants.filter((participant) => participant.active).length} actifs`;
  els.lastUpdated.textContent = dateTimeLabel(lastUpdated);
  els.drawMeterFill.style.width = `${Math.round(coverageRatio * 100)}%`;

  if (state.nextDraw.coveredByGains) {
    els.nextDrawStatus.textContent = "Payé par nos gains";
    els.drawMeterText.textContent = `Le prochain tirage du ${dateLabel(state.nextDraw.date)} est couvert. Il restera ${money(state.nextDraw.remainderAfterPayment)} dans nos gains.`;
  } else {
    els.nextDrawStatus.textContent = `${money(state.nextDraw.missingAmount)} manquant`;
    els.drawMeterText.textContent = `Il manque ${money(state.nextDraw.missingAmount)} pour couvrir le prochain tirage du ${dateLabel(state.nextDraw.date)}. Sinon, -${money(state.drawCostPerParticipant)} par participant.`;
  }
}

function renderParticipants() {
  els.participantList.innerHTML = state.participants
    .map((participant) => {
      const className = participant.balance < 0 ? "negative" : "positive";
      const active = participant.id === selectedId ? " active" : "";
      const meta = participant.balance < 0 ? "A rattraper" : "Solde disponible";
      return `
        <button class="participant-row${active}" type="button" data-participant="${escapeHtml(participant.id)}">
          <span>
            <span class="participant-name">${escapeHtml(participant.name)}</span>
            <span class="participant-meta">${meta}</span>
          </span>
          <span class="money ${className}">${money(participant.balance)}</span>
        </button>
      `;
    })
    .join("");

  els.participantList.querySelectorAll("[data-participant]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.participant;
      localStorage.setItem(SELECTED_MEMBER_KEY, selectedId);
      render();
    });
  });
}

function renderMemberDetail() {
  const participant = getSelectedParticipant();
  if (!participant) return;

  const status = participant.balance < 0 ? "Negatif" : "Actif";
  const className = participant.balance < 0 ? "negative" : "positive";

  els.detailTitle.textContent = participant.name;
  els.detailStatus.textContent = status;
  els.memberDetail.innerHTML = `
    <div class="detail-top">
      <div>
        <h3>${escapeHtml(participant.name)}</h3>
        <p>Information detaillee visible quand on clique sur son nom.</p>
      </div>
      <strong class="money ${className}">${money(participant.balance)}</strong>
    </div>

    <div class="coverage-grid">
      <article>
        <span>Solde actuel</span>
        <strong>${money(participant.balance)}</strong>
      </article>
      <article>
        <span>Couvre</span>
        <strong>${participant.coveredDraws} tirages</strong>
      </article>
      <article>
        <span>Reste apres</span>
        <strong>${money(participant.remainder)}</strong>
      </article>
    </div>

    <p class="detail-subtitle">Historique avec dates</p>
    <div class="history-list">
      ${participant.history.map(renderHistoryRow).join("")}
    </div>
  `;
}

function renderGroupHistory() {
  els.groupHistory.innerHTML = state.groupHistory.map(renderHistoryRow).join("");
}

function renderHistoryRow(entry) {
  return `
    <div class="history-row">
      <span>
        <span class="history-title">${escapeHtml(entry.title)}</span>
        <span class="history-meta">${dateLabel(entry.date)} - ${escapeHtml(entry.meta)}</span>
      </span>
      <span class="money ${entry.amount < 0 ? "negative" : "positive"}">${signedMoney(entry.amount)}</span>
    </div>
  `;
}

async function addTransaction(event) {
  event.preventDefault();

  try {
    const body = {
      type: els.transactionType.value,
      participantId: els.transactionType.value === "gain" ? null : els.participantSelect.value,
      amount: Number(els.amountInput.value),
      date: els.dateInput.value,
      paymentMode: els.paymentMode.value,
      note: els.noteInput.value.trim(),
      adminPin: getAdminPin()
    };

    state = await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (body.participantId) {
      selectedId = body.participantId;
      localStorage.setItem(SELECTED_MEMBER_KEY, selectedId);
    }

    els.noteInput.value = "";
    render();
    showToast("Transaction enregistree.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  }
}

async function applyDraw() {
  try {
    const confirmed = window.confirm(`Appliquer le prochain tirage du ${dateLabel(state.nextDraw.date)}?`);
    if (!confirmed) return;

    state = await api("/api/draws/apply", {
      method: "POST",
      body: JSON.stringify({ adminPin: getAdminPin() })
    });
    render();
    showToast("Tirage applique.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  }
}

async function addParticipant(event) {
  event.preventDefault();

  try {
    const name = els.newParticipantName.value.trim();
    const body = {
      name,
      openingBalance: Number(els.newParticipantBalance.value || 0),
      date: els.dateInput.value,
      active: els.newParticipantActive.checked,
      paymentMode: els.newParticipantPaymentMode.value,
      note: els.newParticipantActive.checked ? "Actif aux tirages" : "Inactif aux tirages",
      adminPin: getAdminPin()
    };

    state = await api("/api/participants", {
      method: "POST",
      body: JSON.stringify(body)
    });

    const created = state.participants.find((participant) => participant.name.toLowerCase() === name.toLowerCase());
    if (created) {
      selectedId = created.id;
      localStorage.setItem(SELECTED_MEMBER_KEY, selectedId);
    }

    els.newParticipantName.value = "";
    els.newParticipantBalance.value = "0";
    els.newParticipantActive.checked = true;
    render();
    showToast("Participant ajouté. Le coût du prochain tirage est recalculé.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 3000);
}

function setToday() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  els.dateInput.value = new Date(today.getTime() - offset).toISOString().slice(0, 10);
}

els.form.addEventListener("submit", addTransaction);
els.participantForm.addEventListener("submit", addParticipant);
els.applyDraw.addEventListener("click", applyDraw);
els.adminToggle.addEventListener("click", unlockAdmin);
els.transactionType.addEventListener("change", renderSelectors);
els.resetDemo.addEventListener("click", () => loadState());

els.resetDemo.textContent = "Rafraichir";
els.adminNote.textContent = "Les participants voient tout en lecture seule. Les actions admin demandent le PIN.";

setToday();
loadState();
window.setInterval(() => loadState({ silent: true }), REFRESH_INTERVAL_MS);
