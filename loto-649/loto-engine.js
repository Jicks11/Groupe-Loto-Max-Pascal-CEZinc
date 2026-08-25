/**
 * Loto Max / 6/49 — moteur local + sync Supabase (même modèle que Lave-auto).
 */
(function (global) {
  const SUPABASE_URL = "https://cvxbijxuitmtwcdmvvwo.supabase.co";
  const SUPABASE_ANON_KEY = String(global.LOTO_SUPABASE_ANON_KEY || "").trim();
  const TZ = "America/Toronto";
  const cache = {};

  function headers() {
    return {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json"
    };
  }

  async function rpc(name, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body || {}),
      cache: "no-store"
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayIso() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;
    return `${y}-${m}-${d}`;
  }

  function nowOffset() {
    return new Date().toISOString();
  }

  function timeOfDayMinutes() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour").value);
    const m = Number(parts.find((p) => p.type === "minute").value);
    return h * 60 + m;
  }

  function addDays(iso, delta) {
    const [y, m, d] = String(iso).split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function weekdayName(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
      new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    ];
  }

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function pinOf(state) {
    return String(state?.settings?.adminPin || "2020");
  }

  function requireAdmin(state, pin) {
    if (String(pin || "") !== pinOf(state)) {
      throw new Error("PIN admin incorrect");
    }
  }

  function isGroupWinsTx(tx) {
    return (
      !tx.participantId &&
      ["gain", "group_draw_payment", "opening", "correction"].includes(String(tx.type || "").toLowerCase())
    );
  }

  function groupWins(state) {
    return (state.transactions || [])
      .filter(isGroupWinsTx)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
  }

  function participantBalance(state, id) {
    return (state.transactions || [])
      .filter((t) => t.participantId === id)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
  }

  function isDeductionDay(state, iso) {
    const days = state.settings.deductionDays || [];
    return days.some((d) => String(d).toLowerCase() === weekdayName(iso).toLowerCase());
  }

  function isDrawApplied(state, iso) {
    return (state.appliedDraws || []).some((d) => d.date === iso);
  }

  function publicOffset(state) {
    return Number(state.publicDrawDateOffsetDays ?? -1);
  }

  function isPublicDrawDay(state, iso) {
    return isDeductionDay(state, addDays(iso, -publicOffset(state)));
  }

  function nextDueDate(state, fromIso) {
    for (let i = 0; i <= 14; i += 1) {
      const date = addDays(fromIso, i);
      if (isDeductionDay(state, date) && !isDrawApplied(state, date)) return date;
    }
    return addDays(fromIso, 1);
  }

  function publicDrawDate(state) {
    const today = todayIso();
    if (timeOfDayMinutes() < 1) {
      const y = addDays(today, -1);
      if (isPublicDrawDay(state, y)) return y;
    }
    for (let i = 0; i <= 14; i += 1) {
      const date = addDays(today, i);
      if (isPublicDrawDay(state, date)) return date;
    }
    return addDays(nextDueDate(state, today), publicOffset(state));
  }

  function lastCompletedPublicDrawDate(state) {
    const today = todayIso();
    for (let i = 0; i <= 30; i += 1) {
      const date = addDays(today, -i);
      if (isPublicDrawDay(state, date) && (i > 0 || timeOfDayMinutes() >= 1)) return date;
    }
    return today;
  }

  function paymentRequiredDate(state, fromIso, coveredDraws) {
    const uncovered = Math.max(0, coveredDraws);
    let seen = 0;
    for (let i = 0; i <= 730; i += 1) {
      const date = addDays(fromIso, i);
      if (!isDeductionDay(state, date) || isDrawApplied(state, date)) continue;
      if (seen === uncovered) return date;
      seen += 1;
    }
    return addDays(fromIso, 1);
  }

  function toHistory(tx) {
    return {
      date: tx.date,
      amount: Number(tx.amount || 0),
      title: tx.title,
      meta: tx.note ? `${tx.paymentMode} - ${tx.note}` : tx.paymentMode
    };
  }

  function buildView(state, includePhotoBytes) {
    const cost = Number(state.settings.drawCostPerParticipant || 0);
    const actives = (state.participants || []).filter((p) => p.active);
    const drawTotal = actives.length * cost;
    const wins = groupWins(state);
    const today = todayIso();
    const participants = (state.participants || []).map((p) => {
      const balance = participantBalance(state, p.id);
      const coveredDraws = balance > 0 && cost > 0 ? Math.floor(balance / cost) : 0;
      const remainder = balance > 0 && cost > 0 ? balance % cost : 0;
      const history = (state.transactions || [])
        .filter((t) => t.participantId === p.id && t.type !== "opening")
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 25)
        .map(toHistory);
      return {
        id: p.id,
        name: p.name,
        active: p.active,
        balance,
        coveredDraws,
        remainder,
        paymentRequiredDate: p.active ? paymentRequiredDate(state, today, coveredDraws) : null,
        history
      };
    });
    const participantTotal = participants.reduce((s, p) => s + Number(p.balance || 0), 0);
    const coverageGroupWins = Math.max(0, wins);
    const paidDraws = drawTotal > 0 ? Math.floor(coverageGroupWins / drawTotal) : 0;
    const winsRemainder = drawTotal > 0 ? coverageGroupWins % drawTotal : 0;
    const nextDate = nextDueDate(state, today);
    const missing = Math.max(0, drawTotal - coverageGroupWins);
    const mapPhoto = (p) => ({
      id: p.id,
      date: p.date,
      imageDataUrl: includePhotoBytes ? p.imageDataUrl || "" : "",
      note: p.note || "",
      createdAt: p.createdAt
    });
    const ticketPhotos = (state.ticketPhotos || [])
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30)
      .map(mapPhoto);
    const resultPhotos = (state.resultPhotos || [])
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30)
      .map(mapPhoto);

    const nonOpening = (state.transactions || []).filter((t) => t.type !== "opening");
    const groupLevel = nonOpening
      .filter((t) => !t.participantId || t.type === "gain" || t.type === "group_draw_payment")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 40);
    const participantLevel = nonOpening
      .filter((t) => t.participantId && t.type !== "gain" && t.type !== "group_draw_payment")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 50);
    const seen = new Set();
    const groupHistory = [...groupLevel, ...participantLevel]
      .filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 80)
      .map((t) => {
        const person = t.participantId
          ? (state.participants || []).find((p) => p.id === t.participantId)?.name
          : null;
        const h = toHistory(t);
        return { ...h, title: person ? `${t.title} - ${person}` : t.title };
      });

    return {
      groupName: state.groupName,
      lastUpdatedAt: state.lastUpdatedAt,
      drawCostPerParticipant: cost,
      deductionDays: state.settings.deductionDays,
      automationEnabled: !!state.settings.automationEnabled,
      participants,
      groupWins: wins,
      participantTotal,
      groupTotal: participantTotal + wins,
      drawTotal,
      paidDraws,
      winsRemainder,
      nextDraw: {
        date: nextDate,
        coveredByGains: drawTotal > 0 && wins >= drawTotal,
        missingAmount: missing,
        remainderAfterPayment: winsRemainder
      },
      prizeInfo: {
        drawDate: publicDrawDate(state),
        jackpotAmount: state.settings.jackpotAmount || "",
        secondaryPrizes: state.settings.secondaryPrizes || "",
        updatedAt: state.settings.prizeInfoUpdatedAt
      },
      lastDrawResult: {
        date: state.lastDrawResult?.date || null,
        amount: Number(state.lastDrawResult?.amount || 0),
        bonusEntries: Number(state.lastDrawResult?.bonusEntries || 0),
        note: state.lastDrawResult?.note || "",
        updatedAt: state.lastDrawResult?.updatedAt
      },
      ticketPhotos,
      resultPhotos,
      groupHistory
    };
  }

  function newTx(date, type, participantId, amount, title, paymentMode, note) {
    return {
      id: uid(),
      date,
      type,
      participantId: participantId || null,
      amount: Number(amount),
      title,
      paymentMode: paymentMode && String(paymentMode).trim() ? String(paymentMode).trim() : "Manuel",
      note: note ? String(note).trim() : "",
      createdAt: nowOffset()
    };
  }

  function applyDraw(state, date, createdBy) {
    if (isDrawApplied(state, date)) {
      throw new Error(`Le tirage du ${date} est deja applique.`);
    }
    const actives = (state.participants || []).filter((p) => p.active);
    if (!actives.length) throw new Error("Aucun participant actif.");
    const cost = Number(state.settings.drawCostPerParticipant);
    const drawTotal = actives.length * cost;
    const wins = groupWins(state);
    if (wins >= drawTotal && drawTotal > 0) {
      state.transactions.unshift(
        newTx(date, "group_draw_payment", null, -drawTotal, "Tirage payé par nos gains", "nos gains", `${actives.length} participants proteges`)
      );
      state.appliedDraws.unshift({
        date,
        paidBy: "gains",
        amount: drawTotal,
        createdAt: nowOffset(),
        createdBy
      });
      return;
    }
    for (const p of actives) {
      state.transactions.unshift(
        newTx(date, "draw", p.id, -cost, "Tirage", "Auto", "Deduction automatique")
      );
    }
    state.appliedDraws.unshift({
      date,
      paidBy: "participants",
      amount: drawTotal,
      createdAt: nowOffset(),
      createdBy
    });
  }

  function processDueDraws(state) {
    if (!state.settings.automationEnabled) return false;
    const today = todayIso();
    const applyThrough = timeOfDayMinutes() < 1 ? addDays(today, -1) : today;
    let changed = false;
    let date = state.settings.automationStartDate || today;
    for (let guard = 0; guard < 800; guard += 1) {
      if (date > applyThrough) break;
      if (isDeductionDay(state, date) && !isDrawApplied(state, date)) {
        applyDraw(state, date, "automatique");
        changed = true;
      }
      date = addDays(date, 1);
    }
    return changed;
  }

  function findParticipant(state, id) {
    if (!id) throw new Error("Choisis un participant.");
    const p = (state.participants || []).find((x) => x.id === id);
    if (!p) throw new Error("Participant introuvable.");
    return p;
  }

  function slugId(state, name) {
    const base = String(name || "participant")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "participant";
    let candidate = base;
    let n = 2;
    const ids = new Set((state.participants || []).map((p) => p.id));
    while (ids.has(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    return candidate;
  }

  function cleanText(value, max) {
    const t = String(value || "").trim();
    return t.slice(0, max);
  }

  async function loadRaw(groupId) {
    if (!SUPABASE_ANON_KEY) throw new Error("Clé Supabase manquante.");
    const payload = await rpc("get_loto_app_state", { p_id: groupId });
    if (!payload || typeof payload !== "object") throw new Error("État Loto introuvable.");
    payload.transactions = payload.transactions || [];
    payload.participants = payload.participants || [];
    payload.appliedDraws = payload.appliedDraws || [];
    payload.ticketPhotos = payload.ticketPhotos || [];
    payload.resultPhotos = payload.resultPhotos || [];
    payload.settings = payload.settings || {};
    cache[groupId] = payload;
    return payload;
  }

  async function saveRaw(groupId, state, pin) {
    state.lastUpdatedAt = nowOffset();
    const saved = await rpc("save_loto_app_state", {
      p_id: groupId,
      p_pin: pin || pinOf(state),
      p_payload: state
    });
    cache[groupId] = saved || state;
    return cache[groupId];
  }

  async function mutate(groupId, pin, fn) {
    const state = JSON.parse(JSON.stringify(await loadRaw(groupId)));
    requireAdmin(state, pin);
    fn(state);
    await saveRaw(groupId, state, pin);
    return buildView(state, true);
  }

  async function view(groupId, includePhotos) {
    const state = JSON.parse(JSON.stringify(await loadRaw(groupId)));
    const changed = processDueDraws(state);
    if (changed) {
      try {
        await saveRaw(groupId, state, pinOf(state));
      } catch {
        /* lecture encore possible */
      }
    }
    return buildView(state, includePhotos);
  }

  async function handle(groupId, path, fetchOptions = {}) {
    const method = String(fetchOptions.method || "GET").toUpperCase();
    const p = String(path || "").replace(/\/$/, "") || "/state";
    let body = {};
    if (fetchOptions.body) {
      try {
        body = typeof fetchOptions.body === "string" ? JSON.parse(fetchOptions.body) : fetchOptions.body;
      } catch {
        body = {};
      }
    }

    if (p === "/ping") return { ok: true, at: nowOffset() };
    if (p === "/state" && method === "GET") return view(groupId, false);
    if (p === "/ticket-photos") {
      const state = await loadRaw(groupId);
      return {
        photos: (state.ticketPhotos || [])
          .slice()
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 30)
      };
    }
    if (p === "/result-photos") {
      const state = await loadRaw(groupId);
      return {
        photos: (state.resultPhotos || [])
          .slice()
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 30)
      };
    }
    if (p === "/admin/check") {
      const state = await loadRaw(groupId);
      requireAdmin(state, body.adminPin);
      return { ok: true };
    }
    if (p === "/transactions") {
      return mutate(groupId, body.adminPin, (state) => {
        const amount = Number(body.amount);
        if (!amount) throw new Error("Le montant ne peut pas etre 0$.");
        const type = String(body.type || "").trim().toLowerCase();
        const date = body.date || todayIso();
        if (type === "gain") {
          state.transactions.unshift(newTx(date, "gain", null, Math.abs(amount), "Gain ajoute", body.paymentMode, body.note));
        } else if (type === "set_balance") {
          const pax = findParticipant(state, body.participantId);
          const current = participantBalance(state, pax.id);
          const diff = amount - current;
          if (!diff) throw new Error("Le solde est deja a ce montant.");
          state.transactions.unshift(newTx(date, "correction", pax.id, diff, "Ajustement solde", body.paymentMode, body.note));
        } else {
          const pax = findParticipant(state, body.participantId);
          const transactionAmount = type === "correction" ? amount : type === "withdrawal" ? -Math.abs(amount) : Math.abs(amount);
          const title = type === "correction" ? "Correction" : type === "withdrawal" ? "Retrait trop-perçu" : "Depot";
          const transactionType = type === "correction" ? "correction" : type === "withdrawal" ? "withdrawal" : "deposit";
          state.transactions.unshift(newTx(date, transactionType, pax.id, transactionAmount, title, body.paymentMode, body.note));
        }
      });
    }
    if (p === "/participants") {
      return mutate(groupId, body.adminPin, (state) => {
        const name = String(body.name || "").trim();
        if (!name) throw new Error("Entre le nom du participant.");
        if ((state.participants || []).some((x) => x.name.toLowerCase() === name.toLowerCase())) {
          throw new Error("Ce participant existe deja.");
        }
        const participant = { id: slugId(state, name), name, active: body.active !== false };
        state.participants.push(participant);
        const opening = Number(body.openingBalance || 0);
        if (opening) {
          state.transactions.unshift(newTx(body.date || todayIso(), "opening", participant.id, opening, "Solde initial", body.paymentMode, body.note));
        }
      });
    }
    if (p === "/participants/status") {
      return mutate(groupId, body.adminPin, (state) => {
        const idx = (state.participants || []).findIndex((x) => x.id === body.participantId);
        if (idx < 0) throw new Error("Participant introuvable.");
        state.participants[idx].active = !!body.active;
      });
    }
    if (p === "/participants/delete") {
      return mutate(groupId, body.adminPin, (state) => {
        const pax = findParticipant(state, body.participantId);
        if (participantBalance(state, pax.id) !== 0) {
          throw new Error("Impossible de supprimer: le solde doit etre a 0$. Desactive le participant a la place.");
        }
        if ((state.transactions || []).some((t) => t.participantId === pax.id)) {
          throw new Error("Impossible de supprimer: ce participant a un historique. Desactive le participant a la place.");
        }
        state.participants = state.participants.filter((x) => x.id !== pax.id);
      });
    }
    if (p === "/draws/apply") {
      return mutate(groupId, body.adminPin, (state) => {
        applyDraw(state, body.date || nextDueDate(state, todayIso()), "manuel");
      });
    }
    if (p === "/draws/participants") {
      return mutate(groupId, body.adminPin, (state) => {
        const date = body.date || todayIso();
        const already = isDrawApplied(state, date);
        const actives = (state.participants || []).filter((x) => x.active);
        if (!actives.length) throw new Error("Aucun participant actif.");
        const cost = Number(state.settings.drawCostPerParticipant);
        const drawTotal = actives.length * cost;
        for (const pax of actives) {
          state.transactions.unshift(
            newTx(
              date,
              "draw",
              pax.id,
              -cost,
              "Tirage",
              "Manuel",
              already ? "Retrait admin supplementaire a tous les participants actifs" : "Retrait admin a tous les participants actifs"
            )
          );
        }
        if (!already) {
          state.appliedDraws.unshift({
            date,
            paidBy: "participants",
            amount: drawTotal,
            createdAt: nowOffset(),
            createdBy: "manuel"
          });
        }
      });
    }
    if (p === "/admin/clear-history") {
      return mutate(groupId, body.adminPin, (state) => {
        const txs = [];
        const wins = groupWins(state);
        const today = todayIso();
        if (wins) {
          txs.push(newTx(today, "opening", null, wins, "nos gains disponibles", "Historique", "Historique nettoyé"));
        }
        for (const pax of state.participants || []) {
          const bal = participantBalance(state, pax.id);
          if (!bal) continue;
          txs.push(newTx(today, "opening", pax.id, bal, "Solde de départ", "Historique", "Historique nettoyé"));
        }
        state.transactions = txs;
      });
    }
    if (p === "/admin/draw-info") {
      return mutate(groupId, body.adminPin, (state) => {
        state.settings.jackpotAmount = cleanText(body.jackpotAmount, 80);
        state.settings.secondaryPrizes = cleanText(body.secondaryPrizes, 120);
        state.settings.prizeInfoUpdatedAt = nowOffset();
      });
    }
    if (p === "/admin/draw-result") {
      return mutate(groupId, body.adminPin, (state) => {
        const amount = Math.max(0, Number(body.amount || 0));
        const bonusEntries = Math.max(0, Number(body.bonusEntries || 0));
        const note = cleanText(body.note, 140);
        const drawDate = body.date || lastCompletedPublicDrawDate(state);
        const replacePrevious = body.replacePrevious === true;
        if (replacePrevious && state.lastDrawResult?.transactionId) {
          state.transactions = state.transactions.filter((t) => t.id !== state.lastDrawResult.transactionId);
        }
        let transactionId = state.lastDrawResult?.transactionId || null;
        if (amount > 0) {
          transactionId = `result-${drawDate}-${uid()}`;
          state.transactions.unshift(
            newTx(
              drawDate,
              "gain",
              null,
              amount,
              replacePrevious ? "Resultat du dernier tirage (corrige)" : "Gain du tirage",
              "Gain du tirage",
              [bonusEntries ? `${bonusEntries} extra` : "", note].filter(Boolean).join(" - ")
            )
          );
        } else if (replacePrevious) {
          transactionId = null;
        }
        state.lastDrawResult = {
          date: drawDate,
          amount,
          bonusEntries,
          note,
          transactionId,
          updatedAt: nowOffset()
        };
      });
    }
    if (p === "/admin/ticket-photos" || p === "/admin/result-photos") {
      return mutate(groupId, body.adminPin, (state) => {
        const imageDataUrl = String(body.imageDataUrl || "").trim();
        if (!imageDataUrl.startsWith("data:image/")) throw new Error("Choisis une image valide.");
        if (imageDataUrl.length > 1400000) throw new Error("L'image est trop lourde. Recadre ou compresse la capture et reessaie.");
        const key = p.includes("ticket") ? "ticketPhotos" : "resultPhotos";
        const date = body.date || (key === "ticketPhotos" ? publicDrawDate(state) : lastCompletedPublicDrawDate(state));
        const photos = (state[key] || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 29);
        photos.unshift({
          id: uid(),
          date,
          imageDataUrl,
          note: cleanText(body.note, 100),
          createdAt: nowOffset()
        });
        state[key] = photos;
      });
    }
    if (p === "/admin/ticket-photos/delete" || p === "/admin/result-photos/delete") {
      return mutate(groupId, body.adminPin, (state) => {
        const key = p.includes("ticket") ? "ticketPhotos" : "resultPhotos";
        state[key] = (state[key] || []).filter((x) => x.id !== body.id);
      });
    }

    throw new Error(`Route inconnue: ${p}`);
  }

  global.LotoEngine = { handle, view };
})(window);
