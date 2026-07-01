const APP_SCOPE = window.location.pathname.startsWith("/loto-649") ? "loto-649" : "loto-max";
const SELECTED_MEMBER_KEY = `${APP_SCOPE}-selected-member`;
const ADMIN_PIN_KEY = `${APP_SCOPE}-admin-pin`;
const REFRESH_INTERVAL_MS = 30000;
const API_TIMEOUT_MS = 15000;
const RENDER_API_ORIGIN = "https://groupe-loto-max-pascal-cezinc.onrender.com";
const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1"]);
const host = window.location.hostname.toLowerCase();
const sameOriginApi = LOCAL_HOSTS.has(host) || host.endsWith(".onrender.com");
const API_ORIGIN = (window.LOTO_API_ORIGIN || (sameOriginApi ? "" : RENDER_API_ORIGIN)).replace(/\/$/, "");
const API_BASE_PATH = APP_SCOPE === "loto-649" ? "/api/loto-649" : "/api";
const API_BASE = `${API_ORIGIN}${API_BASE_PATH}`;
const ADMIN_BUTTON_LABEL = "Mode Admin r\u00e9serv\u00e9 \u00e0 Pascal";
const CURRENT_GROUP_LABEL = APP_SCOPE === "loto-649" ? "6/49" : "Loto Max";
const OTHER_GROUP_LABEL = APP_SCOPE === "loto-649" ? "Loto Max" : "6/49";
const OTHER_API_BASE_PATH = APP_SCOPE === "loto-649" ? "/api" : "/api/loto-649";
const JACKPOT_TONE_CLASSES = [
  "jackpot-tone-white",
  "jackpot-tone-green",
  "jackpot-tone-blue",
  "jackpot-tone-violet",
  "jackpot-tone-orange",
  "jackpot-tone-rose"
];

function cleanLegacyBrowserCache() {
  if ("serviceWorker" in navigator && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => registrations.forEach((registration) => registration.unregister()))
      .catch(() => {});
  }

  if ("caches" in window) {
    window.caches.keys()
      .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
      .catch(() => {});
  }
}

cleanLegacyBrowserCache();

const els = {
  startupOverlay: document.querySelector("#startupOverlay"),
  startupMessage: document.querySelector("#startupMessage"),
  startupProgress: document.querySelector("#startupProgress"),
  lastUpdated: document.querySelector("#lastUpdated"),
  publicDrawDate: document.querySelector("#publicDrawDate"),
  jackpotAmount: document.querySelector("#jackpotAmount"),
  secondaryPrizes: document.querySelector("#secondaryPrizes"),
  prizeShareEstimate: document.querySelector("#prizeShareEstimate"),
  nextDrawStatus: document.querySelector("#nextDrawStatus"),
  drawMeterFill: document.querySelector("#drawMeterFill"),
  drawMeterText: document.querySelector("#drawMeterText"),
  groupWins: document.querySelector("#groupWins"),
  winsCoverage: document.querySelector("#winsCoverage"),
  lastResultAmount: document.querySelector("#lastResultAmount"),
  lastResultMeta: document.querySelector("#lastResultMeta"),
  participantTotal: document.querySelector("#participantTotal"),
  groupTotal: document.querySelector("#groupTotal"),
  drawTotal: document.querySelector("#drawTotal"),
  drawFormula: document.querySelector("#drawFormula"),
  ticketPhotoCount: document.querySelector("#ticketPhotoCount"),
  ticketSummary: document.querySelector("#ticketSummary"),
  openTickets: document.querySelector("#openTickets"),
  closeTickets: document.querySelector("#closeTickets"),
  ticketsModal: document.querySelector("#ticketsModal"),
  ticketGallery: document.querySelector("#ticketGallery"),
  activeCount: document.querySelector("#activeCount"),
  participantList: document.querySelector("#participantList"),
  detailTitle: document.querySelector("#detailTitle"),
  detailStatus: document.querySelector("#detailStatus"),
  memberDetail: document.querySelector("#memberDetail"),
  groupHistory: document.querySelector("#groupHistory"),
  form: document.querySelector("#transactionForm"),
  drawInfoForm: document.querySelector("#drawInfoForm"),
  drawResultForm: document.querySelector("#drawResultForm"),
  ticketPhotoForm: document.querySelector("#ticketPhotoForm"),
  participantForm: document.querySelector("#participantForm"),
  transactionType: document.querySelector("#transactionType"),
  participantField: document.querySelector("#participantField"),
  participantSelect: document.querySelector("#participantSelect"),
  manageParticipantSelect: document.querySelector("#manageParticipantSelect"),
  amountLabel: document.querySelector("#amountLabel"),
  amountInput: document.querySelector("#amountInput"),
  dateInput: document.querySelector("#dateInput"),
  paymentMode: document.querySelector("#paymentMode"),
  noteInput: document.querySelector("#noteInput"),
  applyDraw: document.querySelector("#applyDraw"),
  clearHistory: document.querySelector("#clearHistory"),
  toggleParticipantActive: document.querySelector("#toggleParticipantActive"),
  deleteParticipant: document.querySelector("#deleteParticipant"),
  jackpotInput: document.querySelector("#jackpotInput"),
  secondaryPrizesInput: document.querySelector("#secondaryPrizesInput"),
  resultDateInput: document.querySelector("#resultDateInput"),
  resultAmountInput: document.querySelector("#resultAmountInput"),
  resultBonusInput: document.querySelector("#resultBonusInput"),
  resultNoteInput: document.querySelector("#resultNoteInput"),
  ticketDateInput: document.querySelector("#ticketDateInput"),
  ticketPhotoInput: document.querySelector("#ticketPhotoInput"),
  ticketNoteInput: document.querySelector("#ticketNoteInput"),
  newParticipantName: document.querySelector("#newParticipantName"),
  newParticipantBalance: document.querySelector("#newParticipantBalance"),
  newParticipantPaymentMode: document.querySelector("#newParticipantPaymentMode"),
  newParticipantActive: document.querySelector("#newParticipantActive"),
  adminToggle: document.querySelector("#adminToggle"),
  adminLocked: document.querySelector("#adminLocked"),
  adminContent: document.querySelector("#adminContent"),
  combinedGroupsTotal: document.querySelector("#combinedGroupsTotal"),
  currentGroupTotalAdmin: document.querySelector("#currentGroupTotalAdmin"),
  otherGroupTotalAdmin: document.querySelector("#otherGroupTotalAdmin"),
  combinedTotalStatus: document.querySelector("#combinedTotalStatus"),
  refreshCombinedTotal: document.querySelector("#refreshCombinedTotal"),
  resetDemo: document.querySelector("#resetDemo"),
  adminNote: document.querySelector("#adminNote"),
  toast: document.querySelector("#toast")
};

let state = null;
let selectedId = localStorage.getItem(SELECTED_MEMBER_KEY);
let adminUnlocked = false;
let stateLoading = false;
let startupStartedAt = 0;
let startupTimer = null;
let startupRetryTimer = null;
let otherGroupState = null;
let combinedTotalLoading = false;
let combinedTotalError = "";

function setStartupProgress(message, percent) {
  if (els.startupMessage) {
    els.startupMessage.textContent = message;
  }
  if (els.startupProgress) {
    els.startupProgress.style.width = `${Math.max(8, Math.min(96, percent))}%`;
  }
}

function showStartupLoading() {
  if (!els.startupOverlay || state) return;

  startupStartedAt = startupStartedAt || Date.now();
  els.startupOverlay.classList.remove("hidden");
  window.clearInterval(startupTimer);
  startupTimer = window.setInterval(() => {
    const elapsed = Date.now() - startupStartedAt;
    const percent = elapsed < 5000
      ? 18 + elapsed / 5000 * 45
      : Math.min(90, 63 + (elapsed - 5000) / 20000 * 27);
    const message = elapsed > 7000
      ? "Le service de donnees se reveille. Les soldes vont apparaitre automatiquement."
      : "Connexion aux donnees du groupe.";
    setStartupProgress(message, percent);
  }, 450);
}

function hideStartupLoading() {
  window.clearInterval(startupTimer);
  window.clearTimeout(startupRetryTimer);
  startupTimer = null;
  startupRetryTimer = null;
  setStartupProgress("Donnees chargees.", 100);
  window.setTimeout(() => {
    els.startupOverlay?.classList.add("hidden");
  }, 180);
}

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

function dateInputValue(isoDate) {
  return isoDate ? String(isoDate).slice(0, 10) : "";
}

function previousDayIso(isoDate) {
  if (!isoDate) return isoDate;
  const date = new Date(`${String(isoDate).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

function previousScheduledDrawIso(referenceIso, drawDays) {
  if (!referenceIso) return "";
  const reference = new Date(`${String(referenceIso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(reference.getTime())) return "";

  for (let offset = 1; offset <= 14; offset += 1) {
    const date = new Date(reference);
    date.setDate(reference.getDate() - offset);
    if (drawDays.includes(date.getDay())) {
      return date.toISOString().slice(0, 10);
    }
  }

  return previousDayIso(referenceIso);
}

function lastResultDefaultDateIso() {
  const nextPublicDraw = state?.prizeInfo?.drawDate || previousDayIso(state?.nextDraw?.date);
  return previousScheduledDrawIso(nextPublicDraw, [2, 5]);
}

function resultDateForDisplay(result, prizeDrawDate) {
  if (!result?.date) return "";
  const resultDate = String(result.date).slice(0, 10);
  const today = new Date();
  const date = new Date(`${resultDate}T23:59:59`);
  const resultDayStart = new Date(`${resultDate}T00:00:00`);
  const resultUpdatedAt = result.updatedAt ? new Date(result.updatedAt) : null;
  const enteredBeforeDrawDate =
    resultUpdatedAt &&
    !Number.isNaN(resultUpdatedAt.getTime()) &&
    resultUpdatedAt < resultDayStart;
  if (resultDate === String(prizeDrawDate || "").slice(0, 10) && (date > today || enteredBeforeDrawDate)) {
    return lastResultDefaultDateIso();
  }
  return resultDate;
}

function nextDrawDateLabel() {
  return dateLabel(state.prizeInfo?.drawDate || previousDayIso(state.nextDraw.date));
}

function nextPaymentDateLabel() {
  return dateLabel(state.nextDraw.date);
}

function setInputValueUnlessFocused(input, value) {
  if (!input || document.activeElement === input) return;
  input.value = value || "";
}

function parsePrizeAmount(value) {
  const text = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ");
  const match = text.match(/\d+(?:[\s.,]\d+)*/);
  if (!match) return null;

  let numberText = match[0].replace(/\s/g, "");
  if (numberText.includes(",") && !numberText.includes(".")) {
    numberText = numberText.replace(",", ".");
  }

  const dotCount = (numberText.match(/\./g) || []).length;
  if (dotCount > 1 || /\.\d{3}(?:\D|$)/.test(numberText)) {
    numberText = numberText.replace(/\./g, "");
  }

  const amount = Number(numberText);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (text.includes("milliard") || /\d\s*b\b/.test(text)) {
    return amount * 1000000000;
  }
  if (text.includes("million") || /\d\s*m\b/.test(text)) {
    return amount * 1000000;
  }
  return amount;
}

function jackpotToneClass(prizeText) {
  const amount = parsePrizeAmount(prizeText);
  if (!amount || amount < 15000000) return "jackpot-tone-white";
  if (amount >= 90000000) return "jackpot-tone-rose";
  if (amount >= 70000000) return "jackpot-tone-orange";
  if (amount >= 50000000) return "jackpot-tone-violet";
  if (amount >= 30000000) return "jackpot-tone-blue";
  return "jackpot-tone-green";
}

function applyJackpotTone(prizeText) {
  els.jackpotAmount.classList.remove(...JACKPOT_TONE_CLASSES);
  els.jackpotAmount.classList.add(jackpotToneClass(prizeText));
}

function prizeShareText(prizeText) {
  const amount = parsePrizeAmount(prizeText);
  const activeCount = state.participants.filter((participant) => participant.active).length;
  if (!amount || activeCount <= 0) {
    return "Part par participant: à confirmer";
  }

  return `Si le gros lot est gagné: environ ${money(amount / activeCount)} par participant actif (${activeCount} actifs)`;
}

function resultMetaText(result) {
  if (!result?.date && !result?.bonusEntries && !result?.note) {
    return "Aucun resultat inscrit";
  }

  const parts = [];
  const displayDate = resultDateForDisplay(result, state?.prizeInfo?.drawDate);
  if (displayDate) {
    parts.push(`Tirage du ${dateLabel(displayDate)}`);
  }
  if (Number(result.bonusEntries || 0) > 0) {
    const count = Number(result.bonusEntries);
    parts.push(count === 1 ? "1 participation gratuite" : `${count} participations gratuites`);
  }
  if (result.note) {
    parts.push(result.note);
  }

  return parts.join(" - ");
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
  const { timeoutMs = API_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = path.startsWith("/api/") ? path.slice(4) : path;
  const url = `${API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {})
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Le serveur prend trop de temps a repondre. Attends quelques minutes et reessaie.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Erreur serveur.");
  }
  return payload;
}

async function fetchGroupState(basePath, options = {}) {
  const { timeoutMs = API_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const url = `${API_ORIGIN}${basePath}/state`;

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Le serveur prend trop de temps a repondre.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Erreur serveur.");
  }
  return payload;
}

async function withButtonBusy(button, label, action) {
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withButtonConfirmation(button, busyLabel, doneLabel, action) {
  if (!button) {
    return action();
  }

  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    const result = await action();
    button.textContent = doneLabel;
    await wait(700);
    return result;
  } finally {
    button.disabled = false;
    button.textContent = previousText;
  }
}

async function loadState({ silent = false } = {}) {
  if (stateLoading) {
    return;
  }

  stateLoading = true;
  if (!silent && !state) {
    els.lastUpdated.textContent = "Chargement des donnees...";
    showStartupLoading();
  }

  try {
    state = await api("/api/state", { timeoutMs: 60000 });
    if (!selectedId || !state.participants.some((participant) => participant.id === selectedId)) {
      selectedId = state.participants.at(-1)?.id || state.participants[0]?.id;
    }
    render();
    if (adminUnlocked) {
      refreshCombinedAdminTotal();
    }
    hideStartupLoading();
  } catch (error) {
    if (!silent) {
      showToast(`Impossible de charger les donnees: ${error.message}`, 6000);
      if (!state) {
        setStartupProgress("Le service de donnees se reveille. Nouvel essai dans quelques secondes.", 88);
        window.clearTimeout(startupRetryTimer);
        startupRetryTimer = window.setTimeout(() => loadState(), 5000);
      }
    }
  } finally {
    stateLoading = false;
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
  return withButtonBusy(els.adminToggle, "Verification...", async () => {
    try {
      const pin = getAdminPin();
      await api("/api/admin/check", {
        method: "POST",
        body: JSON.stringify({ adminPin: pin }),
        timeoutMs: 12000
      });
      adminUnlocked = true;
      render();
      refreshCombinedAdminTotal();
      showToast("Mode admin active.");
    } catch (error) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
      showToast(error.message, 6000);
    }
  });
}

function renderAdminMode() {
  els.adminLocked.classList.toggle("hidden", adminUnlocked);
  els.adminContent.classList.toggle("hidden", !adminUnlocked);
  els.adminToggle.textContent = adminUnlocked ? "Admin actif - Pascal" : ADMIN_BUTTON_LABEL;
  renderCombinedAdminTotal();
}

function renderCombinedAdminTotal() {
  if (
    !els.combinedGroupsTotal ||
    !els.currentGroupTotalAdmin ||
    !els.otherGroupTotalAdmin ||
    !els.combinedTotalStatus
  ) {
    return;
  }

  const currentTotal = Number(state?.groupTotal || 0);
  const otherTotal = otherGroupState ? Number(otherGroupState.groupTotal || 0) : 0;
  els.currentGroupTotalAdmin.textContent = `${CURRENT_GROUP_LABEL}: ${money(currentTotal)}`;
  els.otherGroupTotalAdmin.textContent = otherGroupState
    ? `${OTHER_GROUP_LABEL}: ${money(otherTotal)}`
    : `${OTHER_GROUP_LABEL}: ${combinedTotalLoading ? "chargement..." : "a charger"}`;
  els.combinedGroupsTotal.textContent = money(currentTotal + otherTotal);

  if (combinedTotalLoading) {
    els.combinedTotalStatus.textContent = "Mise a jour du total combine...";
  } else if (combinedTotalError) {
    els.combinedTotalStatus.textContent = combinedTotalError;
  } else if (otherGroupState) {
    els.combinedTotalStatus.textContent = "Total combine calcule avec les 2 groupes.";
  } else {
    els.combinedTotalStatus.textContent = "Visible seulement en mode admin.";
  }
}

async function refreshCombinedAdminTotal() {
  if (!adminUnlocked || combinedTotalLoading || !els.combinedGroupsTotal) return;

  combinedTotalLoading = true;
  combinedTotalError = "";
  renderCombinedAdminTotal();
  try {
    otherGroupState = await fetchGroupState(OTHER_API_BASE_PATH, { timeoutMs: 30000 });
    renderCombinedAdminTotal();
  } catch (error) {
    combinedTotalError = `Impossible de charger ${OTHER_GROUP_LABEL}: ${error.message}`;
  } finally {
    combinedTotalLoading = false;
    renderCombinedAdminTotal();
  }
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
  renderTickets();
  renderAdminMode();
}

function renderSelectors() {
  const currentValue = els.participantSelect.value || selectedId;
  const currentManageValue = els.manageParticipantSelect.value || selectedId;
  els.participantSelect.innerHTML = state.participants
    .map((participant) => `<option value="${escapeHtml(participant.id)}">${escapeHtml(participant.name)}</option>`)
    .join("");
  els.manageParticipantSelect.innerHTML = els.participantSelect.innerHTML;
  els.participantSelect.value = currentValue;
  els.manageParticipantSelect.value = currentManageValue;

  const isGroupGain = els.transactionType.value === "gain";
  els.participantField.style.display = isGroupGain ? "none" : "grid";
  els.amountLabel.textContent =
    els.transactionType.value === "set_balance"
      ? "Nouveau solde exact"
      : els.transactionType.value === "withdrawal"
        ? "Montant à enlever"
        : "Montant";
  if (isGroupGain) {
    els.paymentMode.value = "Billet gratuit";
  } else if (els.transactionType.value === "set_balance") {
    els.paymentMode.value = "Correction";
  } else if (els.transactionType.value === "withdrawal") {
    els.paymentMode.value = "Trop-perçu";
  }
}

function renderMetrics() {
  const coverageRatio = state.drawTotal > 0 ? Math.min(state.groupWins / state.drawTotal, 1) : 0;
  const lastUpdated = new Date(state.lastUpdatedAt);
  const prizeInfo = state.prizeInfo || {};

  els.publicDrawDate.textContent = nextDrawDateLabel();
  els.jackpotAmount.textContent = (prizeInfo.jackpotAmount || "").trim() || "À confirmer";
  applyJackpotTone(prizeInfo.jackpotAmount);
  els.secondaryPrizes.textContent = (prizeInfo.secondaryPrizes || "").trim() || "Lots additionnels à confirmer";
  els.prizeShareEstimate.textContent = prizeShareText(prizeInfo.jackpotAmount);
  setInputValueUnlessFocused(els.jackpotInput, prizeInfo.jackpotAmount || "");
  setInputValueUnlessFocused(els.secondaryPrizesInput, prizeInfo.secondaryPrizes || "");
  const result = state.lastDrawResult || {};
  els.lastResultAmount.textContent = Number(result.amount || 0) > 0 ? money(result.amount) : "Aucun lot";
  els.lastResultMeta.textContent = resultMetaText(result);
  setInputValueUnlessFocused(els.resultDateInput, dateInputValue(result.date || lastResultDefaultDateIso()));
  setInputValueUnlessFocused(els.resultAmountInput, String(result.amount || 0));
  setInputValueUnlessFocused(els.resultBonusInput, String(result.bonusEntries || 0));
  setInputValueUnlessFocused(els.resultNoteInput, result.note || "");
  setInputValueUnlessFocused(els.ticketDateInput, dateInputValue(prizeInfo.drawDate));
  els.groupWins.textContent = money(state.groupWins);
  els.winsCoverage.textContent = state.paidDraws === 1 ? "1 tirage couvert" : `${state.paidDraws} tirages couverts`;
  els.participantTotal.textContent = money(state.participantTotal);
  els.groupTotal.textContent = money(state.groupTotal);
  if (els.drawTotal) {
    els.drawTotal.textContent = money(state.drawTotal);
  }
  if (els.drawFormula) {
    els.drawFormula.textContent = `${state.participants.filter((participant) => participant.active).length} x ${money(state.drawCostPerParticipant)}`;
  }
  els.activeCount.textContent = `${state.participants.filter((participant) => participant.active).length} actifs`;
  els.lastUpdated.textContent = dateTimeLabel(lastUpdated);
  els.drawMeterFill.style.width = `${Math.round(coverageRatio * 100)}%`;

  if (state.nextDraw.coveredByGains) {
    els.nextDrawStatus.textContent = "Payé par nos gains";
    els.drawMeterText.textContent = `Le prochain paiement automatique est couvert par nos gains. Le retrait passera le ${nextPaymentDateLabel()}; il restera ${money(state.nextDraw.remainderAfterPayment)} dans nos gains.`;
  } else {
    els.nextDrawStatus.textContent = `${money(state.nextDraw.missingAmount)} manquant`;
    els.drawMeterText.textContent = `Il manque ${money(state.nextDraw.missingAmount)} dans nos gains pour couvrir le prochain paiement automatique. Si nos gains ne suffisent pas, un retrait de ${money(state.drawCostPerParticipant)} par participant sera appliqué le ${nextPaymentDateLabel()}.`;
  }
}

function renderParticipants() {
  els.participantList.innerHTML = state.participants
    .map((participant) => {
      const className = participant.balance < 0 ? "negative" : "positive";
      const active = participant.id === selectedId ? " active" : "";
      const meta = !participant.active ? "Inactif" : participant.balance < 0 ? "A rattraper" : "Solde disponible";
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

  const status = !participant.active ? "Inactif" : participant.balance < 0 ? "Negatif" : "Actif";
  const paymentRequiredText = participant.active
    ? dateLabel(participant.paymentRequiredDate)
    : "Inactif";
  const paymentRequiredNote = participant.active
    ? "Premier tirage non couvert"
    : "Aucun retrait automatique";

  els.detailTitle.textContent = participant.name;
  els.detailStatus.textContent = status;
  els.memberDetail.innerHTML = `
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
      <article>
        <span>Paiement requis</span>
        <strong>${paymentRequiredText}</strong>
        <small>${paymentRequiredNote}</small>
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

function renderTickets() {
  const photos = state.ticketPhotos || [];
  const latestDate = photos[0]?.date;
  els.ticketPhotoCount.textContent = photos.length === 1 ? "1 photo" : `${photos.length} photos`;
  els.ticketSummary.textContent = photos.length
    ? `${photos.length} photo${photos.length > 1 ? "s" : ""} ajoutée${photos.length > 1 ? "s" : ""}${latestDate ? ` pour le tirage du ${dateLabel(latestDate)}` : ""}.`
    : "Aucune photo ajoutée pour le moment.";
  els.openTickets.disabled = photos.length === 0;
  els.ticketGallery.innerHTML = photos.length
    ? photos.map(renderTicketPhoto).join("")
    : `<p class="empty-state">Aucune photo de billet pour le moment.</p>`;

  els.ticketGallery.querySelectorAll("[data-delete-ticket]").forEach((button) => {
    button.addEventListener("click", () => deleteTicketPhoto(button.dataset.deleteTicket));
  });
}

function renderTicketPhoto(photo) {
  return `
    <article class="ticket-card">
      <a href="${escapeHtml(photo.imageDataUrl)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(photo.imageDataUrl)}" alt="Billet du ${dateLabel(photo.date)}" loading="lazy" />
      </a>
      <div>
        <strong>${dateLabel(photo.date)}</strong>
        <small>${escapeHtml(photo.note || "Photo de billet")}</small>
      </div>
      ${adminUnlocked ? `<button class="danger-button compact-button" type="button" data-delete-ticket="${escapeHtml(photo.id)}">Supprimer</button>` : ""}
    </article>
  `;
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

  return withButtonConfirmation(
    event.submitter || els.form.querySelector("button[type='submit']"),
    "Enregistrement...",
    "Enregistre",
    async () => {
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
        throw error;
      }
    }
  ).catch(() => {});
}

async function applyDraw() {
  return withButtonBusy(els.applyDraw, "Retrait...", async () => {
    const date = els.dateInput.value || state.nextDraw.date;
    const activeCount = state.participants.filter((participant) => participant.active).length;
    const confirmed = window.confirm(
      `Retirer ${money(state.drawCostPerParticipant)} a ${activeCount} participants actifs pour le ${dateLabel(date)}?\n\n` +
        `Total: ${money(activeCount * state.drawCostPerParticipant)}.\n` +
        "Cette action ignore nos gains. Elle peut servir de correction meme si la date a deja ete traitee."
    );
    if (!confirmed) return;

    state = await api("/api/draws/participants", {
      method: "POST",
      body: JSON.stringify({ date, adminPin: getAdminPin() }),
      timeoutMs: 15000
    });
    render();
    showToast("Retrait applique a tous les participants actifs.");
  }).catch((error) => {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message, 6000);
  });
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

async function clearHistory() {
  try {
    const confirmed = window.confirm(
      "Nettoyer l'historique public?\n\n" +
        "Les soldes actuels seront conserves comme soldes de depart. Les anciennes lignes d'historique seront retirees."
    );
    if (!confirmed) return;

    state = await api("/api/admin/clear-history", {
      method: "POST",
      body: JSON.stringify({ adminPin: getAdminPin() })
    });
    render();
    showToast("Historique nettoye. Soldes conserves.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  }
}

async function updateDrawInfo(event) {
  event.preventDefault();

  return withButtonBusy(event.submitter || els.drawInfoForm.querySelector("button[type='submit']"), "Sauvegarde...", async () => {
    state = await api("/api/admin/draw-info", {
      method: "POST",
      body: JSON.stringify({
        jackpotAmount: els.jackpotInput.value.trim(),
        secondaryPrizes: els.secondaryPrizesInput.value.trim(),
        adminPin: getAdminPin()
      }),
      timeoutMs: 45000
    });
    render();
    showToast("Info du gros lot mise a jour.");
  }).catch((error) => {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  });
}

async function updateDrawResult(event) {
  event.preventDefault();

  return withButtonBusy(event.submitter || els.drawResultForm.querySelector("button[type='submit']"), "Sauvegarde...", async () => {
    state = await api("/api/admin/draw-result", {
      method: "POST",
      body: JSON.stringify({
        date: els.resultDateInput.value || null,
        amount: Number(els.resultAmountInput.value || 0),
        bonusEntries: Number(els.resultBonusInput.value || 0),
        note: els.resultNoteInput.value.trim(),
        adminPin: getAdminPin()
      }),
      timeoutMs: 45000
    });
    render();
    showToast("Resultat du dernier tirage mis a jour.");
  }).catch((error) => {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message, 6000);
  });
}

async function uploadTicketPhotos(event) {
  event.preventDefault();
  const files = Array.from(els.ticketPhotoInput.files || []);
  if (files.length === 0) {
    showToast("Choisis au moins une photo.");
    return;
  }

  return withButtonBusy(event.submitter || els.ticketPhotoForm.querySelector("button[type='submit']"), "Publication...", async () => {
    for (const file of files) {
      const imageDataUrl = await compressImage(file);
      state = await api("/api/admin/ticket-photos", {
        method: "POST",
        body: JSON.stringify({
          date: els.ticketDateInput.value || null,
          imageDataUrl,
          note: els.ticketNoteInput.value.trim(),
          adminPin: getAdminPin()
        }),
        timeoutMs: 60000
      });
    }

    els.ticketPhotoInput.value = "";
    els.ticketNoteInput.value = "";
    render();
    showToast(files.length === 1 ? "Photo de billet publiee." : "Photos de billets publiees.");
  }).catch((error) => {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message, 6000);
  });
}

async function deleteTicketPhoto(id) {
  if (!id) return;
  const confirmed = window.confirm("Supprimer cette photo de billet?");
  if (!confirmed) return;

  try {
    state = await api("/api/admin/ticket-photos/delete", {
      method: "POST",
      body: JSON.stringify({ id, adminPin: getAdminPin() }),
      timeoutMs: 30000
    });
    render();
    showToast("Photo supprimee.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message, 6000);
  }
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Le fichier choisi n'est pas une image."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire l'image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Impossible de preparer l'image."));
      image.onload = () => {
        const maxSize = 1600;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function setParticipantActive() {
  try {
    const participant = state.participants.find((item) => item.id === els.manageParticipantSelect.value);
    if (!participant) return;

    const nextActive = !participant.active;
    const confirmed = window.confirm(
      `${nextActive ? "Activer" : "Desactiver"} ${participant.name}?\n\n` +
        (nextActive
          ? "Il comptera dans les prochains tirages."
          : "Il restera visible, mais ne comptera plus dans les prochains tirages.")
    );
    if (!confirmed) return;

    state = await api("/api/participants/status", {
      method: "POST",
      body: JSON.stringify({
        participantId: participant.id,
        active: nextActive,
        adminPin: getAdminPin()
      })
    });
    render();
    showToast(nextActive ? "Participant active." : "Participant desactive.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  }
}

async function deleteParticipant() {
  try {
    const participant = state.participants.find((item) => item.id === els.manageParticipantSelect.value);
    if (!participant) return;

    const confirmed = window.confirm(
      `Supprimer ${participant.name}?\n\n` +
        "Securite: le serveur refusera si son solde n'est pas a 0$ ou s'il a deja un historique."
    );
    if (!confirmed) return;

    state = await api("/api/participants/delete", {
      method: "POST",
      body: JSON.stringify({
        participantId: participant.id,
        adminPin: getAdminPin()
      })
    });
    selectedId = state.participants[0]?.id || null;
    if (selectedId) {
      localStorage.setItem(SELECTED_MEMBER_KEY, selectedId);
    } else {
      localStorage.removeItem(SELECTED_MEMBER_KEY);
    }
    render();
    showToast("Participant supprime.");
  } catch (error) {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message);
  }
}

function showToast(message, duration = 3000) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, duration);
}

function setToday() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  els.dateInput.value = new Date(today.getTime() - offset).toISOString().slice(0, 10);
}

els.form.addEventListener("submit", addTransaction);
els.drawInfoForm.addEventListener("submit", updateDrawInfo);
els.drawResultForm.addEventListener("submit", updateDrawResult);
els.ticketPhotoForm.addEventListener("submit", uploadTicketPhotos);
els.participantForm.addEventListener("submit", addParticipant);
els.applyDraw.addEventListener("click", applyDraw);
els.clearHistory.addEventListener("click", clearHistory);
els.toggleParticipantActive.addEventListener("click", setParticipantActive);
els.deleteParticipant.addEventListener("click", deleteParticipant);
els.adminToggle.addEventListener("click", unlockAdmin);
els.refreshCombinedTotal?.addEventListener("click", () =>
  withButtonBusy(els.refreshCombinedTotal, "Calcul...", refreshCombinedAdminTotal));
els.transactionType.addEventListener("change", renderSelectors);
els.resetDemo.addEventListener("click", () => withButtonBusy(els.resetDemo, "Chargement...", () => loadState()));
els.openTickets.addEventListener("click", () => els.ticketsModal.classList.remove("hidden"));
els.closeTickets.addEventListener("click", () => els.ticketsModal.classList.add("hidden"));
els.ticketsModal.addEventListener("click", (event) => {
  if (event.target === els.ticketsModal) {
    els.ticketsModal.classList.add("hidden");
  }
});

els.resetDemo.textContent = "Rafraichir";
els.adminNote.textContent = "";

setToday();
loadState();
window.setInterval(() => loadState({ silent: true }), REFRESH_INTERVAL_MS);
