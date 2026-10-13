const APP_SCOPE = window.location.pathname.includes("loto-649") ? "loto-649" : "loto-max";
const SELECTED_MEMBER_KEY = `${APP_SCOPE}-selected-member`;
const ADMIN_PIN_KEY = `${APP_SCOPE}-admin-pin`;
const STATE_CACHE_KEY = `${APP_SCOPE}-state-cache-v6`;
const REFRESH_INTERVAL_MS = 180000;
const API_TIMEOUT_MS = 15000;
const LOTO_GROUP_ID = APP_SCOPE === "loto-649" ? "loto-649" : "loto-max";
const OTHER_GROUP_ID = APP_SCOPE === "loto-649" ? "loto-max" : "loto-649";
const ADMIN_BUTTON_LABEL = "Mode Admin r\u00e9serv\u00e9 \u00e0 Pascal";
const CURRENT_GROUP_LABEL = APP_SCOPE === "loto-649" ? "6/49" : "Loto Max";
const OTHER_GROUP_LABEL = APP_SCOPE === "loto-649" ? "Loto Max" : "6/49";
const OTHER_API_BASE_PATH = APP_SCOPE === "loto-649" ? "../" : "./loto-649/";
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
  activeCount: document.querySelector("#activeCount"),
  participantList: document.querySelector("#participantList"),
  detailTitle: document.querySelector("#detailTitle"),
  detailStatus: document.querySelector("#detailStatus"),
  memberDetail: document.querySelector("#memberDetail"),
  groupHistory: document.querySelector("#groupHistory"),
  setBalanceForm: document.querySelector("#setBalanceForm"),
  setBalanceParticipant: document.querySelector("#setBalanceParticipant"),
  setBalanceCurrent: document.querySelector("#setBalanceCurrent"),
  setBalanceAmount: document.querySelector("#setBalanceAmount"),
  setBalanceDate: document.querySelector("#setBalanceDate"),
  setBalanceNote: document.querySelector("#setBalanceNote"),
  form: document.querySelector("#transactionForm"),
  drawInfoForm: document.querySelector("#drawInfoForm"),
  drawResultForm: document.querySelector("#drawResultForm"),
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

function readCachedState() {
  try {
    const raw = localStorage.getItem(STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.state?.participants) return null;
    // Keep cache for 14 days — good enough for a snappy first paint.
    if (parsed.savedAt && Date.now() - parsed.savedAt > 14 * 24 * 60 * 60 * 1000) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

function writeCachedState(nextState) {
  try {
    const light = {
      ...nextState,
      ticketPhotos: [],
      resultPhotos: []
    };
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), state: light }));
  } catch {
    // quota / private mode
  }
}

function setStartupProgress(message, percent) {
  if (els.startupMessage) {
    els.startupMessage.textContent = message;
  }
  if (els.startupProgress) {
    els.startupProgress.style.width = `${Math.max(8, Math.min(96, percent))}%`;
  }
}

function showStartupLoading() {
  if (!els.startupOverlay) return;
  // Always show overlay while the first network load is in progress.
  els.startupOverlay.classList.remove("hidden");
  startupStartedAt = Date.now();
  window.clearInterval(startupTimer);
  setStartupProgress("Connexion aux donnees du groupe…", 12);
  startupTimer = window.setInterval(() => {
    const elapsed = Date.now() - startupStartedAt;
    const percent = elapsed < 4000
      ? 12 + (elapsed / 4000) * 50
      : Math.min(92, 62 + ((elapsed - 4000) / 15000) * 30);
    const message = elapsed > 6000
      ? "Chargement des soldes en cours. Merci de patienter…"
      : "Connexion aux donnees du groupe…";
    setStartupProgress(message, percent);
  }, 200);
}

function hideStartupLoading() {
  window.clearInterval(startupTimer);
  window.clearTimeout(startupRetryTimer);
  startupTimer = null;
  startupRetryTimer = null;
  setStartupProgress("Donnees chargees.", 100);
  window.setTimeout(() => {
    els.startupOverlay?.classList.add("hidden");
  }, 80);
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

function groupDrawWeekdays() {
  const nameToDay = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6
  };
  const fromState = (state?.deductionDays || [])
    .map((name) => nameToDay[String(name).toLowerCase()])
    .filter((day) => Number.isInteger(day));
  if (fromState.length) return fromState;
  // Fallback: Lotto Max mar/ven ; 6/49 jeu/dim (jours de retraits du groupe)
  return APP_SCOPE === "loto-649" ? [4, 0] : [2, 5];
}

function lastResultDefaultDateIso() {
  const nextPublicDraw = state?.prizeInfo?.drawDate || previousDayIso(state?.nextDraw?.date);
  return previousScheduledDrawIso(nextPublicDraw, groupDrawWeekdays());
}

/** Date du formulaire "résultat" : récente si mise à jour aujourd'hui, sinon dernier tirage passé. */
function resultFormDefaultDateIso() {
  const result = state?.lastDrawResult;
  if (result?.updatedAt && result?.date) {
    const updated = new Date(result.updatedAt);
    if (!Number.isNaN(updated.getTime())) {
      const now = new Date();
      const sameDay =
        updated.getFullYear() === now.getFullYear() &&
        updated.getMonth() === now.getMonth() &&
        updated.getDate() === now.getDate();
      if (sameDay) {
        return String(result.date).slice(0, 10);
      }
    }
  }
  return lastResultDefaultDateIso();
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
  return dateLabel(state?.prizeInfo?.drawDate || previousDayIso(state?.nextDraw?.date));
}

function nextPaymentDateLabel() {
  return dateLabel(state?.nextDraw?.date);
}

function on(el, event, handler) {
  if (!el || typeof el.addEventListener !== "function") return;
  el.addEventListener(event, handler);
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value;
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
  if (!els.jackpotAmount) return;
  els.jackpotAmount.classList.remove(...JACKPOT_TONE_CLASSES);
  els.jackpotAmount.classList.add(jackpotToneClass(prizeText));
}

function prizeShareText(prizeText) {
  const amount = parsePrizeAmount(prizeText);
  const activeCount = (state?.participants || []).filter((participant) => participant.active).length;
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
  if (!window.LotoEngine) {
    throw new Error("Moteur Loto introuvable.");
  }
  const endpoint = path.startsWith("/api/") ? path.slice(4) : path;
  const route = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  try {
    return await window.LotoEngine.handle(LOTO_GROUP_ID, route, options);
  } catch (error) {
    throw new Error(error.message || "Erreur serveur.");
  }
}

async function fetchGroupState(_basePath, _options = {}) {
  if (!window.LotoEngine) {
    throw new Error("Moteur Loto introuvable.");
  }
  return window.LotoEngine.view(OTHER_GROUP_ID, false);
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
  try {
    if (!silent && !state) {
      setText(els.lastUpdated, "Chargement des donnees...");
      showStartupLoading();
    } else if (!silent && state) {
      setStartupProgress("Mise a jour des soldes...", 70);
    }

    state = await api("/api/state", { timeoutMs: 60000 });
    state.ticketPhotos = [];
    state.resultPhotos = [];
    if (!selectedId || !(state.participants || []).some((participant) => participant.id === selectedId)) {
      selectedId = state.participants?.at(-1)?.id || state.participants?.[0]?.id;
    }
    writeCachedState(state);
    try {
      render();
    } catch (renderError) {
      console.error(renderError);
      showToast("Affichage partiel — reessai…", 3000);
    }
    if (adminUnlocked) {
      refreshCombinedAdminTotal();
    }
    if (!silent) hideStartupLoading();
  } catch (error) {
    if (!silent) {
      if (state) {
        showToast(`Mise a jour en cours: ${error.message}`, 4000);
        hideStartupLoading();
      } else {
        showToast(`Impossible de charger les donnees: ${error.message}`, 6000);
        setStartupProgress("Connexion en cours. Nouvel essai dans 2 secondes…", 88);
        window.clearTimeout(startupRetryTimer);
        startupRetryTimer = window.setTimeout(() => loadState(), 2000);
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
  try {
    renderSelectors();
    renderMetrics();
    renderParticipants();
    renderMemberDetail();
    renderGroupHistory();
    renderAdminMode();
  } catch (error) {
    console.error("Render error", error);
    try { localStorage.removeItem(STATE_CACHE_KEY); } catch { /* ignore */ }
    throw error;
  }
}

function renderSelectors() {
  if (!els.participantSelect || !els.manageParticipantSelect) return;
  const currentValue = els.participantSelect.value || selectedId;
  const currentManageValue = els.manageParticipantSelect.value || selectedId;
  els.participantSelect.innerHTML = (state.participants || [])
    .map((participant) => `<option value="${escapeHtml(participant.id)}">${escapeHtml(participant.name)}</option>`)
    .join("");
  els.manageParticipantSelect.innerHTML = els.participantSelect.innerHTML;
  els.participantSelect.value = currentValue;
  els.manageParticipantSelect.value = currentManageValue;

  if (els.setBalanceParticipant) {
    const currentSet = els.setBalanceParticipant.value || selectedId || currentValue;
    els.setBalanceParticipant.innerHTML = els.participantSelect.innerHTML;
    els.setBalanceParticipant.value = currentSet;
    const picked = (state.participants || []).find((p) => p.id === els.setBalanceParticipant.value);
    if (els.setBalanceCurrent) {
      els.setBalanceCurrent.textContent = picked ? money(picked.balance) : "—";
    }
    if (els.setBalanceAmount && picked && document.activeElement !== els.setBalanceAmount) {
      if (!els.setBalanceAmount.value) {
        els.setBalanceAmount.placeholder = String(Number(picked.balance || 0));
      }
    }
  }

  const type = els.transactionType?.value || "deposit";
  const isGroupGain = type === "gain";
  if (els.participantField) {
    els.participantField.style.display = isGroupGain ? "none" : "grid";
  }
  if (els.amountLabel) {
    els.amountLabel.textContent =
      type === "set_balance"
        ? "Nouveau solde exact"
        : type === "withdrawal"
          ? "Montant à enlever"
          : "Montant";
  }
  if (els.paymentMode) {
    if (isGroupGain) {
      els.paymentMode.value = "Billet gratuit";
    } else if (type === "set_balance") {
      els.paymentMode.value = "Correction";
    } else if (type === "withdrawal") {
      els.paymentMode.value = "Trop-perçu";
    }
  }
}

function renderMetrics() {
  const drawTotal = Number(state.drawTotal || 0);
  const groupWins = Number(state.groupWins || 0);
  const coverageRatio = drawTotal > 0 ? Math.min(groupWins / drawTotal, 1) : 0;
  const lastUpdated = new Date(state.lastUpdatedAt || Date.now());
  const prizeInfo = state.prizeInfo || {};
  const nextDraw = state.nextDraw || {
    date: "",
    coveredByGains: false,
    missingAmount: drawTotal,
    remainderAfterPayment: 0
  };

  setText(els.publicDrawDate, nextDrawDateLabel());
  setText(els.jackpotAmount, (prizeInfo.jackpotAmount || "").trim() || "À confirmer");
  applyJackpotTone(prizeInfo.jackpotAmount);
  setText(els.secondaryPrizes, (prizeInfo.secondaryPrizes || "").trim() || "Lots additionnels à confirmer");
  setText(els.prizeShareEstimate, prizeShareText(prizeInfo.jackpotAmount));
  setInputValueUnlessFocused(els.jackpotInput, prizeInfo.jackpotAmount || "");
  setInputValueUnlessFocused(els.secondaryPrizesInput, prizeInfo.secondaryPrizes || "");
  const result = state.lastDrawResult || {};
  // Ne pas figer une vieille date de résultat (ex: juin) : le gain disparaissait de l'historique.
  setInputValueUnlessFocused(els.resultDateInput, dateInputValue(resultFormDefaultDateIso()));
  setInputValueUnlessFocused(els.resultAmountInput, String(result.amount || 0));
  setInputValueUnlessFocused(els.resultBonusInput, String(result.bonusEntries || 0));
  setInputValueUnlessFocused(els.resultNoteInput, result.note || "");
  const resultDate = result.date ? dateLabel(String(result.date).slice(0, 10)) : "";
  const resultNote = String(result.note || "").trim();
  setText(els.lastResultAmount, money(result.amount || 0));
  setText(els.lastResultMeta, [resultDate, resultNote].filter(Boolean).join(" · ") || "Aucun résultat enregistré");
  setText(els.groupWins, money(groupWins));
  setText(els.winsCoverage, state.paidDraws === 1 ? "1 tirage couvert" : `${state.paidDraws || 0} tirages couverts`);
  setText(els.participantTotal, money(state.participantTotal));
  setText(els.groupTotal, money(state.groupTotal));
  if (els.drawTotal) {
    els.drawTotal.textContent = money(drawTotal);
  }
  if (els.drawFormula) {
    els.drawFormula.textContent = `${(state.participants || []).filter((participant) => participant.active).length} x ${money(state.drawCostPerParticipant)}`;
  }
  setText(
    els.activeCount,
    `${(state.participants || []).filter((participant) => participant.active).length} actifs`
  );
  setText(els.lastUpdated, dateTimeLabel(lastUpdated));
  if (els.drawMeterFill) {
    els.drawMeterFill.style.width = `${Math.round(coverageRatio * 100)}%`;
  }

  if (nextDraw.coveredByGains) {
    setText(els.nextDrawStatus, "Payé par nos gains");
    setText(
      els.drawMeterText,
      `Nos gains: ${money(groupWins)} (tirage ${money(drawTotal)}). Couvert par les gains. Retrait auto le ${nextPaymentDateLabel()}; il restera ${money(nextDraw.remainderAfterPayment)}.`
    );
  } else {
    setText(els.nextDrawStatus, `${money(nextDraw.missingAmount)} manquant`);
    setText(
      els.drawMeterText,
      `Nos gains: ${money(groupWins)} sur ${money(drawTotal)} pour le prochain paiement. Il manque ${money(nextDraw.missingAmount)}. Sans gains suffisants, retrait de ${money(state.drawCostPerParticipant)} / participant le ${nextPaymentDateLabel()}.`
    );
  }
}

function renderParticipants() {
  if (!els.participantList) return;
  els.participantList.innerHTML = (state.participants || [])
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
        const amount = parseMoneyInput(els.amountInput.value);
        const txType = els.transactionType.value;
        if (!Number.isFinite(amount) || (amount === 0 && txType !== "set_balance")) {
          throw new Error("Montant invalide.");
        }
        const previousWins = Number(state?.groupWins || 0);
        const body = {
          type: els.transactionType.value,
          participantId: els.transactionType.value === "gain" ? null : els.participantSelect.value,
          amount,
          date: els.dateInput.value || new Date().toISOString().slice(0, 10),
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
        if (body.type === "gain") {
          const newWins = Number(state.groupWins || 0);
          const delta = newWins - previousWins;
          showToast(
            `Gain de ${money(body.amount)} enregistr?. Nos gains: ${money(previousWins)} ? ${money(newWins)}` +
              (delta === 0 ? " (aucun changement ? v?rifie le serveur)" : ` (+${money(delta)})`)
          );
        } else {
          showToast("Transaction enregistree.");
        }
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
    showToast("Participant ajout?. Le co?t du prochain tirage est recalcul?.");
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

function parseMoneyInput(value) {
  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

async function submitDrawResult({ replacePrevious, button }) {
  const previousWins = Number(state?.groupWins || 0);
  const amount = parseMoneyInput(els.resultAmountInput.value);
  if (!Number.isFinite(amount) || amount < 0) {
    showToast("Montant invalide.");
    return;
  }
  if (amount === 0 && !replacePrevious) {
    showToast("Entre un montant plus grand que 0$ pour ajouter un gain.");
    return;
  }

  return withButtonBusy(button, replacePrevious ? "Correction..." : "Ajout...", async () => {
    state = await api("/api/admin/draw-result", {
      method: "POST",
      body: JSON.stringify({
        date: els.resultDateInput.value || null,
        amount,
        bonusEntries: Number(els.resultBonusInput.value || 0) || 0,
        note: els.resultNoteInput.value.trim(),
        adminPin: getAdminPin(),
        replacePrevious: !!replacePrevious
      }),
      timeoutMs: 45000
    });
    render();
    const newWins = Number(state.groupWins || 0);
    const delta = newWins - previousWins;
    if (amount > 0) {
      showToast(
        `${replacePrevious ? "R?sultat corrig?" : "Gain ajout?"}: ${money(amount)}. ` +
          `Nos gains: ${money(previousWins)} ? ${money(newWins)}` +
          (delta === 0 ? " (aucun changement net)" : ` (${delta > 0 ? "+" : ""}${money(delta)})`) +
          `. Prochain: ${state.nextDraw?.coveredByGains ? "couvert" : money(state.nextDraw?.missingAmount) + " manquant"}.`,
        7000
      );
    } else {
      showToast(`R?sultat corrig?. Nos gains: ${money(newWins)}.`);
    }
  }).catch((error) => {
    if (String(error.message).includes("PIN")) {
      sessionStorage.removeItem(ADMIN_PIN_KEY);
    }
    showToast(error.message, 6000);
  });
}

async function updateDrawResult(event) {
  event.preventDefault();
  const button = event.submitter || els.drawResultForm?.querySelector("button[type='submit']");
  // Bouton principal = TOUJOURS ajouter (s'additionne dans nos gains)
  return submitDrawResult({ replacePrevious: false, button });
}

async function replaceDrawResult() {
  const button = document.querySelector("#replaceResultGain");
  return submitDrawResult({ replacePrevious: true, button });
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
  const iso = new Date(today.getTime() - offset).toISOString().slice(0, 10);
  if (els.dateInput) els.dateInput.value = iso;
  if (els.setBalanceDate) els.setBalanceDate.value = iso;
}

async function applyExactBalance(event) {
  event.preventDefault();
  const participantId = els.setBalanceParticipant?.value;
  const amount = parseMoneyInput(els.setBalanceAmount?.value);
  if (!participantId) {
    showToast("Choisis un participant.");
    return;
  }
  if (!Number.isFinite(amount)) {
    showToast("Entre le nouveau solde (0 est permis).");
    return;
  }
  const person = (state.participants || []).find((p) => p.id === participantId);
  const current = Number(person?.balance || 0);
  if (amount === current) {
    showToast("Le solde est déjà à ce montant.");
    return;
  }
  const ok = window.confirm(
    `${person?.name || "Participant"}\nSolde actuel: ${money(current)}\nNouveau solde: ${money(amount)}\n\nAppliquer cette correction ?`
  );
  if (!ok) return;

  return withButtonConfirmation(
    event.submitter || els.setBalanceForm.querySelector("button[type='submit']"),
    "Correction...",
    "Corrigé",
    async () => {
      state = await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          type: "set_balance",
          participantId,
          amount,
          date: els.setBalanceDate?.value || new Date().toISOString().slice(0, 10),
          paymentMode: "Correction",
          note: (els.setBalanceNote?.value || "").trim(),
          adminPin: getAdminPin()
        })
      });
      selectedId = participantId;
      localStorage.setItem(SELECTED_MEMBER_KEY, selectedId);
      if (els.setBalanceAmount) els.setBalanceAmount.value = "";
      if (els.setBalanceNote) els.setBalanceNote.value = "";
      render();
      showToast(`${person?.name}: ${money(current)} → ${money(amount)}`);
    }
  ).catch((error) => {
    showToast(error.message || "Correction impossible.");
  });
}

on(els.setBalanceForm, "submit", applyExactBalance);
on(els.setBalanceParticipant, "change", renderSelectors);
on(els.form, "submit", addTransaction);
on(els.drawInfoForm, "submit", updateDrawInfo);
on(els.drawResultForm, "submit", updateDrawResult);
on(document.querySelector("#replaceResultGain"), "click", replaceDrawResult);
on(els.participantForm, "submit", addParticipant);
on(els.applyDraw, "click", applyDraw);
on(els.clearHistory, "click", clearHistory);
on(els.toggleParticipantActive, "click", setParticipantActive);
on(els.deleteParticipant, "click", deleteParticipant);
on(els.adminToggle, "click", unlockAdmin);
on(els.refreshCombinedTotal, "click", () =>
  withButtonBusy(els.refreshCombinedTotal, "Calcul...", refreshCombinedAdminTotal));
on(els.transactionType, "change", renderSelectors);
on(els.resetDemo, "click", () => withButtonBusy(els.resetDemo, "Chargement...", () => loadState()));
if (els.resetDemo) els.resetDemo.textContent = "Rafraichir";
if (els.adminNote) els.adminNote.textContent = "";

setToday();

// Wipe broken older caches once (v1/v2 could freeze the progress bar).
try {
  ["loto-max-state-cache-v2", "loto-649-state-cache-v2", "loto-max-state-cache", "loto-649-state-cache"]
    .forEach((key) => localStorage.removeItem(key));
} catch { /* ignore */ }

// Force clean start if ?reset=1 in URL (useful on iPhone PWA).
try {
  if (new URLSearchParams(location.search).has("reset")) {
    Object.keys(localStorage)
      .filter((key) => key.includes("loto-") || key.includes("state-cache"))
      .forEach((key) => localStorage.removeItem(key));
  }
} catch { /* ignore */ }

// Optional instant paint from last good visit — never block the network load.
const cachedBoot = readCachedState();
if (cachedBoot?.participants?.length && cachedBoot?.nextDraw) {
  try {
    state = cachedBoot;
    if (!selectedId || !state.participants.some((p) => p.id === selectedId)) {
      selectedId = state.participants.at(-1)?.id || state.participants[0]?.id;
    }
    render();
    setText(els.lastUpdated, "Mise a jour en arriere-plan…");
  } catch (error) {
    console.error("Cache boot failed", error);
    state = null;
    try { localStorage.removeItem(STATE_CACHE_KEY); } catch { /* ignore */ }
  }
}

// Always run a real network load (and always animate the progress bar until it finishes).
showStartupLoading();
loadState();
window.setInterval(() => loadState({ silent: true }), REFRESH_INTERVAL_MS);
