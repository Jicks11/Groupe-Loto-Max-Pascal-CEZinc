using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.WriteIndented = true;
});
builder.Services.AddSingleton<LotoStore>();
builder.Services.AddHostedService<DrawScheduler>();

var app = builder.Build();
var configuredStaticRoot = Environment.GetEnvironmentVariable("LOTOMAX_STATIC_ROOT");
var staticRoot = Path.GetFullPath(string.IsNullOrWhiteSpace(configuredStaticRoot)
    ? Path.Combine(app.Environment.ContentRootPath, "..", "loto-max")
    : configuredStaticRoot);

app.MapGet("/", () => Results.Content(File.ReadAllText(Path.Combine(staticRoot, "index.html")), "text/html; charset=utf-8"));
app.MapGet("/api/health", (LotoStore store) => Results.Ok(new
{
    status = "ok",
    checkedAt = LotoClock.Now,
    timeZone = LotoClock.TimeZoneId,
    storage = store.StorageMode
}));
app.MapGet("/loto-max/", () => Results.Content(File.ReadAllText(Path.Combine(staticRoot, "index.html")), "text/html; charset=utf-8"));
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(staticRoot),
    RequestPath = "/loto-max"
});

app.MapGet("/api/state", (LotoStore store) => Results.Ok(store.GetView()));

app.MapPost("/api/transactions", (TransactionRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.AddTransaction(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (Exception exception)
    {
        return Results.BadRequest(new { error = $"Erreur technique pendant la transaction: {exception.Message}" });
    }
});

app.MapPost("/api/participants", (ParticipantRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.AddParticipant(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (Exception exception)
    {
        return Results.BadRequest(new { error = $"Erreur technique pendant l'ajout du participant: {exception.Message}" });
    }
});

app.MapPost("/api/participants/status", (ParticipantStatusRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.SetParticipantActive(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/participants/delete", (ParticipantDeleteRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.DeleteParticipant(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/draws/apply", (DrawRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.ApplyManualDraw(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/draws/participants", (DrawRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.ApplyParticipantDraw(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
    catch (Exception exception)
    {
        return Results.BadRequest(new { error = $"Erreur technique pendant le retrait: {exception.Message}" });
    }
});

app.MapPost("/api/admin/reseed", (AdminRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.Reseed(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/admin/clear-history", (AdminRequest request, LotoStore store) =>
{
    try
    {
        return Results.Ok(store.ClearHistory(request));
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.MapPost("/api/admin/check", (AdminRequest request, LotoStore store) =>
{
    try
    {
        store.CheckAdmin(request);
        return Results.Ok(new { ok = true });
    }
    catch (LotoException exception)
    {
        return Results.BadRequest(new { error = exception.Message });
    }
});

app.Run();

public sealed class DrawScheduler(LotoStore store, ILogger<DrawScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                store.ProcessDueDraws();
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Erreur pendant le traitement automatique des tirages.");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}

public sealed class LotoStore(IHostEnvironment environment)
{
    private readonly object _gate = new();
    private readonly string _dataPath = Path.GetFullPath(string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("LOTOMAX_DATA_PATH"))
        ? Path.Combine(environment.ContentRootPath, "..", "data", "loto-max-state.json")
        : Environment.GetEnvironmentVariable("LOTOMAX_DATA_PATH")!);
    private readonly string? _adminPin = Environment.GetEnvironmentVariable("LOTOMAX_ADMIN_PIN");
    private readonly LotoDatabase? _database = LotoDatabase.Create();
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
    private LotoState? _cachedState;
    private DateTimeOffset _lastDatabaseRefresh = DateTimeOffset.MinValue;
    private static readonly TimeSpan DatabaseRefreshInterval = TimeSpan.FromMinutes(5);

    public string StorageMode => _database is null ? "file" : "postgres";

    public LotoView GetView()
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            var changed = ProcessDueDraws(state, LotoClock.Today);
            if (changed)
            {
                Save(state);
            }

            return BuildView(state);
        }
    }

    public LotoView AddTransaction(TransactionRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);

            var date = request.Date ?? LotoClock.Today;
            var amount = request.Amount;
            if (amount == 0)
            {
                throw new LotoException("Le montant ne peut pas etre 0$.");
            }

            var type = request.Type.Trim().ToLowerInvariant();
            if (type == "gain")
            {
                var gain = Math.Abs(amount);
                state.Transactions.Insert(0, NewTransaction(
                    date,
                    "gain",
                    null,
                    gain,
                    "Gain ajoute",
                    request.PaymentMode,
                    request.Note));
            }
            else if (type == "set_balance")
            {
                var participant = FindParticipant(state, request.ParticipantId);
                var currentBalance = ParticipantBalance(state, participant.Id);
                var difference = amount - currentBalance;
                if (difference == 0)
                {
                    throw new LotoException("Le solde est deja a ce montant.");
                }

                state.Transactions.Insert(0, NewTransaction(
                    date,
                    "correction",
                    participant.Id,
                    difference,
                    "Ajustement solde",
                    request.PaymentMode,
                    request.Note));
            }
            else
            {
                var participant = FindParticipant(state, request.ParticipantId);
                var transactionAmount = type switch
                {
                    "correction" => amount,
                    "withdrawal" => -Math.Abs(amount),
                    _ => Math.Abs(amount)
                };
                var title = type switch
                {
                    "correction" => "Correction",
                    "withdrawal" => "Retrait trop-perçu",
                    _ => "Depot"
                };
                var transactionType = type switch
                {
                    "correction" => "correction",
                    "withdrawal" => "withdrawal",
                    _ => "deposit"
                };

                state.Transactions.Insert(0, NewTransaction(
                    date,
                    transactionType,
                    participant.Id,
                    transactionAmount,
                    title,
                    request.PaymentMode,
                    request.Note));
            }

            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView AddParticipant(ParticipantRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);

            var name = (request.Name ?? "").Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                throw new LotoException("Entre le nom du participant.");
            }

            if (state.Participants.Any(participant => string.Equals(participant.Name, name, StringComparison.OrdinalIgnoreCase)))
            {
                throw new LotoException("Ce participant existe deja.");
            }

            var participant = new LotoParticipant(NewParticipantId(state, name), name, request.Active ?? true);
            state.Participants.Add(participant);

            var openingBalance = request.OpeningBalance ?? 0;
            if (openingBalance != 0)
            {
                state.Transactions.Insert(0, NewTransaction(
                    request.Date ?? LotoClock.Today,
                    "opening",
                    participant.Id,
                    openingBalance,
                    "Solde initial",
                    request.PaymentMode,
                    request.Note));
            }

            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView SetParticipantActive(ParticipantStatusRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);

            var index = state.Participants.FindIndex(participant => participant.Id == request.ParticipantId);
            if (index < 0)
            {
                throw new LotoException("Participant introuvable.");
            }

            state.Participants[index] = state.Participants[index] with { Active = request.Active };
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView DeleteParticipant(ParticipantDeleteRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);
            var participant = FindParticipant(state, request.ParticipantId);
            var balance = ParticipantBalance(state, participant.Id);

            if (balance != 0)
            {
                throw new LotoException("Impossible de supprimer: le solde doit etre a 0$. Desactive le participant a la place.");
            }

            if (state.Transactions.Any(transaction => transaction.ParticipantId == participant.Id))
            {
                throw new LotoException("Impossible de supprimer: ce participant a un historique. Desactive le participant a la place.");
            }

            state.Participants.RemoveAll(item => item.Id == participant.Id);
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView ApplyManualDraw(DrawRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);
            var date = request.Date ?? NextDueDate(state, LotoClock.Today);
            ApplyDraw(state, date, "manuel");
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView ApplyParticipantDraw(DrawRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);
            var date = request.Date ?? LotoClock.Today;
            ApplyParticipantDraw(state, date, "manuel");
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView Reseed(AdminRequest request)
    {
        lock (_gate)
        {
            var current = Load(useCache: true);
            ValidateAdmin(current, request.AdminPin);
            var seed = SeedState();
            Save(seed);
            return BuildView(seed);
        }
    }

    public LotoView ClearHistory(AdminRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            ValidateAdmin(state, request.AdminPin);

            var now = LotoClock.Now;
            var today = LotoClock.Today;
            var transactions = new List<LotoTransaction>();
            var groupWins = GroupWins(state);

            if (groupWins != 0)
            {
                transactions.Add(new LotoTransaction(
                    Guid.NewGuid().ToString("N"),
                    today,
                    "opening",
                    null,
                    groupWins,
                    "nos gains disponibles",
                    "Historique",
                    "Historique nettoyé",
                    now));
            }

            foreach (var participant in state.Participants)
            {
                var balance = ParticipantBalance(state, participant.Id);
                if (balance == 0)
                {
                    continue;
                }

                transactions.Add(new LotoTransaction(
                    Guid.NewGuid().ToString("N"),
                    today,
                    "opening",
                    participant.Id,
                    balance,
                    "Solde de départ",
                    "Historique",
                    "Historique nettoyé",
                    now));
            }

            state = state with
            {
                Transactions = transactions,
                LastUpdatedAt = now
            };
            Save(state);
            return BuildView(state);
        }
    }

    public void CheckAdmin(AdminRequest request)
    {
        lock (_gate)
        {
            if (!string.IsNullOrWhiteSpace(_adminPin))
            {
                ValidateAdminPin(_adminPin, request.AdminPin);
                return;
            }

            ValidateAdmin(Load(useCache: true), request.AdminPin);
        }
    }

    public void ProcessDueDraws()
    {
        lock (_gate)
        {
            var state = Load(useCache: true);
            var changed = ProcessDueDraws(state, LotoClock.Today);
            if (changed)
            {
                state = state with { LastUpdatedAt = LotoClock.Now };
                Save(state);
            }
        }
    }

    private bool ProcessDueDraws(LotoState state, DateOnly today)
    {
        if (!state.Settings.AutomationEnabled)
        {
            return false;
        }

        var changed = false;
        var start = state.Settings.AutomationStartDate;
        for (var date = start; date <= today; date = date.AddDays(1))
        {
            if (!IsDeductionDay(state, date) || IsDrawApplied(state, date))
            {
                continue;
            }

            ApplyDraw(state, date, "automatique");
            changed = true;
        }

        return changed;
    }

    private void ApplyDraw(LotoState state, DateOnly date, string createdBy)
    {
        if (IsDrawApplied(state, date))
        {
            throw new LotoException($"Le tirage du {date:yyyy-MM-dd} est deja applique.");
        }

        var activeParticipants = state.Participants.Where(participant => participant.Active).ToList();
        if (activeParticipants.Count == 0)
        {
            throw new LotoException("Aucun participant actif.");
        }

        var drawTotal = activeParticipants.Count * state.Settings.DrawCostPerParticipant;
        var groupWins = GroupWins(state);

        if (groupWins >= drawTotal)
        {
            state.Transactions.Insert(0, NewTransaction(
                date,
                "group_draw_payment",
                null,
                -drawTotal,
                "Tirage payé par nos gains",
                "nos gains",
                $"{activeParticipants.Count} participants proteges"));

            state.AppliedDraws.Insert(0, new AppliedDraw(date, "gains", drawTotal, LotoClock.Now, createdBy));
            return;
        }

        foreach (var participant in activeParticipants)
        {
            state.Transactions.Insert(0, NewTransaction(
                date,
                "draw",
                participant.Id,
                -state.Settings.DrawCostPerParticipant,
                "Tirage",
                "Auto",
                "Deduction automatique"));
        }

        state.AppliedDraws.Insert(0, new AppliedDraw(date, "participants", drawTotal, LotoClock.Now, createdBy));
    }

    private void ApplyParticipantDraw(LotoState state, DateOnly date, string createdBy)
    {
        var alreadyApplied = IsDrawApplied(state, date);

        var activeParticipants = state.Participants.Where(participant => participant.Active).ToList();
        if (activeParticipants.Count == 0)
        {
            throw new LotoException("Aucun participant actif.");
        }

        var drawTotal = activeParticipants.Count * state.Settings.DrawCostPerParticipant;
        foreach (var participant in activeParticipants)
        {
            state.Transactions.Insert(0, NewTransaction(
                date,
                "draw",
                participant.Id,
                -state.Settings.DrawCostPerParticipant,
                "Tirage",
                "Manuel",
                alreadyApplied
                    ? "Retrait admin supplementaire a tous les participants actifs"
                    : "Retrait admin a tous les participants actifs"));
        }

        if (!alreadyApplied)
        {
            state.AppliedDraws.Insert(0, new AppliedDraw(date, "participants", drawTotal, LotoClock.Now, createdBy));
        }
    }

    private LotoState Load(bool useCache)
    {
        if (useCache && _cachedState is not null && LotoClock.Now - _lastDatabaseRefresh < DatabaseRefreshInterval)
        {
            return _cachedState;
        }

        LotoState state;
        if (_database is not null)
        {
            try
            {
                var databaseState = _database.Load();
                if (databaseState is not null)
                {
                    if (databaseState.Participants.Count == 0)
                    {
                        var recoveredState = _database.LoadLatestSnapshotWithParticipants() ?? LoadFileOrSeedSafely();
                        TrySaveDatabase(recoveredState, "empty-database-recovery");
                        state = recoveredState;
                        CacheState(state, refreshedFromDatabase: true);
                        return state;
                    }

                    if (NormalizeState(databaseState))
                    {
                        TrySaveDatabase(databaseState, "normalize");
                    }

                    state = databaseState;
                    CacheState(state, refreshedFromDatabase: true);
                    return state;
                }

                var imported = LoadFileOrSeedSafely();
                TrySaveDatabase(imported, "initial-import");
                state = imported;
                CacheState(state, refreshedFromDatabase: true);
                return state;
            }
            catch
            {
                if (_cachedState is not null)
                {
                    return _cachedState;
                }

                state = LoadFileOrSeedSafely();
                CacheState(state, refreshedFromDatabase: false);
                return state;
            }
        }

        state = LoadFileOrSeed(saveIfMissing: true);
        CacheState(state, refreshedFromDatabase: false);
        return state;
    }

    private void CacheState(LotoState state, bool refreshedFromDatabase)
    {
        _cachedState = state;
        if (refreshedFromDatabase)
        {
            _lastDatabaseRefresh = LotoClock.Now;
        }
    }

    private LotoState LoadFileOrSeedSafely()
    {
        try
        {
            return LoadFileOrSeed(saveIfMissing: false);
        }
        catch
        {
            return SeedState();
        }
    }

    private LotoState LoadFileOrSeed(bool saveIfMissing)
    {
        if (saveIfMissing)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_dataPath)!);
        }

        if (!File.Exists(_dataPath))
        {
            var seed = SeedState();
            if (saveIfMissing)
            {
                Save(seed);
            }

            return seed;
        }

        var json = File.ReadAllText(_dataPath);
        var state = JsonSerializer.Deserialize<LotoState>(json, _jsonOptions) ?? SeedState();
        if (NormalizeState(state))
        {
            Save(state);
        }

        return state;
    }

    private void TrySaveDatabase(LotoState state, string reason)
    {
        try
        {
            _database?.Save(state, reason);
        }
        catch
        {
        }
    }

    private void Save(LotoState state)
    {
        if (state.Participants.Count == 0)
        {
            throw new LotoException("Protection des soldes: sauvegarde refusee car aucun participant n'est present.");
        }

        if (_database is not null)
        {
            _database.Save(state, "save");
            CacheState(state, refreshedFromDatabase: true);
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(_dataPath)!);
        if (File.Exists(_dataPath))
        {
            File.Copy(_dataPath, $"{_dataPath}.bak", overwrite: true);
        }

        var json = JsonSerializer.Serialize(state, _jsonOptions);
        File.WriteAllText(_dataPath, json);
        CacheState(state, refreshedFromDatabase: false);
    }

    private static bool NormalizeState(LotoState state)
    {
        var days = state.Settings.DeductionDays;
        var hasOldSchedule =
            days.Count == 2 &&
            days.Any(day => string.Equals(day, "Thursday", StringComparison.OrdinalIgnoreCase)) &&
            days.Any(day => string.Equals(day, "Sunday", StringComparison.OrdinalIgnoreCase));

        if (!hasOldSchedule)
        {
            return false;
        }

        days.Clear();
        days.Add("Tuesday");
        days.Add("Friday");
        return true;
    }

    private LotoView BuildView(LotoState state)
    {
        var activeParticipants = state.Participants.Where(participant => participant.Active).ToList();
        var drawTotal = activeParticipants.Count * state.Settings.DrawCostPerParticipant;
        var groupWins = GroupWins(state);
        var participants = state.Participants
            .Select(participant =>
            {
                var balance = ParticipantBalance(state, participant.Id);
                var coveredDraws = balance > 0 ? (int)Math.Floor(balance / state.Settings.DrawCostPerParticipant) : 0;
                var remainder = balance > 0 ? balance % state.Settings.DrawCostPerParticipant : 0;
                var history = ParticipantHistory(state, participant.Id);
                return new ParticipantView(participant.Id, participant.Name, participant.Active, balance, coveredDraws, remainder, history);
            })
            .ToList();
        var participantTotal = participants.Sum(participant => participant.Balance);
        var paidDraws = drawTotal > 0 ? (int)Math.Floor(groupWins / drawTotal) : 0;
        var winsRemainder = drawTotal > 0 ? groupWins % drawTotal : 0;
        var nextDate = NextDueDate(state, LotoClock.Today);
        var missing = Math.Max(0, drawTotal - groupWins);
        var nextDraw = new NextDrawView(nextDate, groupWins >= drawTotal, missing, winsRemainder);

        return new LotoView(
            state.GroupName,
            state.LastUpdatedAt,
            state.Settings.DrawCostPerParticipant,
            state.Settings.DeductionDays,
            state.Settings.AutomationEnabled,
            participants,
            groupWins,
            participantTotal,
            participantTotal + groupWins,
            drawTotal,
            paidDraws,
            winsRemainder,
            nextDraw,
            GroupHistory(state));
    }

    private static decimal GroupWins(LotoState state) =>
        state.Transactions
            .Where(transaction => transaction.ParticipantId is null)
            .Sum(transaction => transaction.Amount);

    private static decimal ParticipantBalance(LotoState state, string participantId) =>
        state.Transactions
            .Where(transaction => transaction.ParticipantId == participantId)
            .Sum(transaction => transaction.Amount);

    private List<HistoryEntryView> ParticipantHistory(LotoState state, string participantId) =>
        state.Transactions
            .Where(transaction => transaction.ParticipantId == participantId)
            .Where(transaction => transaction.Type != "opening")
            .OrderByDescending(transaction => transaction.Date)
            .ThenByDescending(transaction => transaction.CreatedAt)
            .Take(25)
            .Select(ToHistoryEntry)
            .ToList();

    private List<HistoryEntryView> GroupHistory(LotoState state) =>
        state.Transactions
            .Where(transaction => transaction.Type != "opening")
            .OrderByDescending(transaction => transaction.Date)
            .ThenByDescending(transaction => transaction.CreatedAt)
            .Take(50)
            .Select(transaction =>
            {
                var participant = transaction.ParticipantId is null
                    ? null
                    : state.Participants.FirstOrDefault(item => item.Id == transaction.ParticipantId)?.Name;
                var title = participant is null ? transaction.Title : $"{transaction.Title} - {participant}";
                return ToHistoryEntry(transaction) with { Title = title };
            })
            .ToList();

    private static HistoryEntryView ToHistoryEntry(LotoTransaction transaction) =>
        new(transaction.Date, transaction.Amount, transaction.Title, string.IsNullOrWhiteSpace(transaction.Note)
            ? transaction.PaymentMode
            : $"{transaction.PaymentMode} - {transaction.Note}");

    private static LotoParticipant FindParticipant(LotoState state, string? participantId)
    {
        if (string.IsNullOrWhiteSpace(participantId))
        {
            throw new LotoException("Choisis un participant.");
        }

        return state.Participants.FirstOrDefault(participant => participant.Id == participantId)
            ?? throw new LotoException("Participant introuvable.");
    }

    private static string NewParticipantId(LotoState state, string name)
    {
        var normalized = name.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder();
        var pendingDash = false;

        foreach (var character in normalized)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsLetterOrDigit(character))
            {
                if (pendingDash && builder.Length > 0)
                {
                    builder.Append('-');
                }

                builder.Append(char.ToLowerInvariant(character));
                pendingDash = false;
                continue;
            }

            pendingDash = builder.Length > 0;
        }

        var baseId = builder.Length == 0 ? "participant" : builder.ToString();
        var candidate = baseId;
        var suffix = 2;
        while (state.Participants.Any(participant => participant.Id == candidate))
        {
            candidate = $"{baseId}-{suffix}";
            suffix++;
        }

        return candidate;
    }

    private static bool IsDrawApplied(LotoState state, DateOnly date) =>
        state.AppliedDraws.Any(draw => draw.Date == date);

    private static bool IsDeductionDay(LotoState state, DateOnly date) =>
        state.Settings.DeductionDays.Any(day => Enum.TryParse<DayOfWeek>(day, true, out var parsed) && parsed == date.DayOfWeek);

    private static DateOnly NextDueDate(LotoState state, DateOnly fromDate)
    {
        for (var offset = 0; offset <= 14; offset++)
        {
            var date = fromDate.AddDays(offset);
            if (IsDeductionDay(state, date) && !IsDrawApplied(state, date))
            {
                return date;
            }
        }

        return fromDate.AddDays(1);
    }

    private static LotoTransaction NewTransaction(
        DateOnly date,
        string type,
        string? participantId,
        decimal amount,
        string title,
        string? paymentMode,
        string? note) =>
        new(
            Guid.NewGuid().ToString("N"),
            date,
            type,
            participantId,
            amount,
            title,
            string.IsNullOrWhiteSpace(paymentMode) ? "Manuel" : paymentMode.Trim(),
            string.IsNullOrWhiteSpace(note) ? "" : note.Trim(),
            LotoClock.Now);

    private void ValidateAdmin(LotoState state, string? adminPin)
    {
        var expectedPin = string.IsNullOrWhiteSpace(_adminPin) ? state.Settings.AdminPin : _adminPin;
        ValidateAdminPin(expectedPin, adminPin);
    }

    private static void ValidateAdminPin(string? expectedPin, string? adminPin)
    {
        if (string.IsNullOrWhiteSpace(expectedPin) || adminPin != expectedPin)
        {
            throw new LotoException("PIN admin invalide.");
        }
    }

    private static LotoState SeedState()
    {
        var now = LotoClock.Now;
        var today = LotoClock.Today;
        var participants = new List<LotoParticipant>
        {
            new("pascal-taillefer", "Pascal Taillefer", true),
            new("etienne-berthiaume", "Etienne Berthiaume", true),
            new("luc-arsenault", "Luc Arsenault", true),
            new("christian-larochelle", "Christian Larochelle", true),
            new("marc-leduc", "Marc Leduc", true),
            new("steve-bertrand", "Steve Bertrand", true),
            new("martine-hamel", "Martine Hamel", true),
            new("keith-saulnier", "Keith Saulnier", true),
            new("simon-prairie", "Simon Prairie", true),
            new("jean-francois-durocher", "Jean-Francois Durocher", true),
            new("alexandre-genest", "Alexandre Genest", true),
            new("mario-dufresne", "Mario Dufresne", true),
            new("roger-leclair", "Roger Leclair", true)
        };

        var openingBalances = new Dictionary<string, decimal>
        {
            ["pascal-taillefer"] = -6,
            ["etienne-berthiaume"] = 24,
            ["luc-arsenault"] = 55,
            ["christian-larochelle"] = 34,
            ["marc-leduc"] = 34,
            ["steve-bertrand"] = 14,
            ["martine-hamel"] = 5,
            ["keith-saulnier"] = -12,
            ["simon-prairie"] = 4,
            ["jean-francois-durocher"] = 4,
            ["alexandre-genest"] = 22,
            ["mario-dufresne"] = 55,
            ["roger-leclair"] = 54
        };

        var transactions = participants
            .Select(participant => new LotoTransaction(
                Guid.NewGuid().ToString("N"),
                today,
                "opening",
                participant.Id,
                openingBalances[participant.Id],
                "Solde importe",
                "Excel",
                "Import initial du groupe",
                now))
            .ToList();

        transactions.Insert(0, new LotoTransaction(
            Guid.NewGuid().ToString("N"),
            today,
            "gain",
            null,
            96,
            "nos gains disponibles",
            "Excel",
            "Import initial du groupe",
            now));

        return new LotoState(
            "Équipe B Moulage — Loto-Max CEZinc",
            new LotoSettings(6, new List<string> { "Tuesday", "Friday" }, today, true, "2468"),
            participants,
            transactions,
            new List<AppliedDraw>(),
            now);
    }
}

public sealed class LotoDatabase
{
    private readonly string _connectionString;
    private readonly object _schemaGate = new();
    private bool _schemaReady;
    private readonly JsonSerializerOptions _snapshotOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    private LotoDatabase(string connectionString)
    {
        _connectionString = connectionString;
    }

    public static LotoDatabase? Create()
    {
        var rawConnectionString =
            Environment.GetEnvironmentVariable("SUPABASE_DB_CONNECTION") ??
            Environment.GetEnvironmentVariable("DATABASE_URL") ??
            Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(rawConnectionString))
        {
            return null;
        }

        return new LotoDatabase(ToNpgsqlConnectionString(rawConnectionString));
    }

    public LotoState? Load()
    {
        using var connection = OpenConnection();
        EnsureSchema(connection);
        return LoadCore(connection, null);
    }

    public LotoState? LoadLatestSnapshotWithParticipants()
    {
        using var connection = OpenConnection();
        EnsureSchema(connection);

        using var command = new NpgsqlCommand("""
            SELECT payload::text
            FROM loto_state_snapshots
            ORDER BY created_at DESC, id DESC
            LIMIT 50;
            """, connection);
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            LotoState? state;
            try
            {
                state = JsonSerializer.Deserialize<LotoState>(reader.GetString(0), _snapshotOptions);
            }
            catch (JsonException)
            {
                continue;
            }

            if (state?.Participants?.Count > 0)
            {
                return state with { LastUpdatedAt = LotoClock.Now };
            }
        }

        return null;
    }

    public void Save(LotoState state, string reason)
    {
        using var connection = OpenConnection();
        EnsureSchema(connection);
        using var transaction = connection.BeginTransaction();

        var existing = LoadCore(connection, transaction);
        if (existing is not null)
        {
            SaveSnapshot(connection, transaction, existing, reason);
        }

        ExecuteNonQuery(connection, transaction, "DELETE FROM loto_applied_draws;");
        ExecuteNonQuery(connection, transaction, "DELETE FROM loto_transactions;");
        ExecuteNonQuery(connection, transaction, "DELETE FROM loto_participants;");
        ExecuteNonQuery(connection, transaction, "DELETE FROM loto_settings;");

        ExecuteNonQuery(connection, transaction, """
            INSERT INTO loto_settings (
                id,
                group_name,
                draw_cost_per_participant,
                deduction_days_json,
                automation_start_date,
                automation_enabled,
                admin_pin,
                last_updated_at
            )
            VALUES (
                1,
                @group_name,
                @draw_cost,
                @deduction_days_json,
                @automation_start_date,
                @automation_enabled,
                @admin_pin,
                @last_updated_at
            );
            """, parameters =>
        {
            parameters.AddWithValue("group_name", state.GroupName);
            parameters.AddWithValue("draw_cost", state.Settings.DrawCostPerParticipant);
            parameters.AddWithValue("deduction_days_json", JsonSerializer.Serialize(state.Settings.DeductionDays));
            parameters.AddWithValue("automation_start_date", ToDateTime(state.Settings.AutomationStartDate));
            parameters.AddWithValue("automation_enabled", state.Settings.AutomationEnabled);
            parameters.AddWithValue("admin_pin", state.Settings.AdminPin);
            parameters.AddWithValue("last_updated_at", state.LastUpdatedAt.ToUniversalTime());
        });

        for (var index = 0; index < state.Participants.Count; index++)
        {
            var participant = state.Participants[index];
            ExecuteNonQuery(connection, transaction, """
                INSERT INTO loto_participants (id, name, active, sort_order)
                VALUES (@id, @name, @active, @sort_order);
                """, parameters =>
            {
                parameters.AddWithValue("id", participant.Id);
                parameters.AddWithValue("name", participant.Name);
                parameters.AddWithValue("active", participant.Active);
                parameters.AddWithValue("sort_order", index);
            });
        }

        var participantIds = state.Participants.Select(participant => participant.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var savedTransactionIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in state.Transactions)
        {
            if (!savedTransactionIds.Add(item.Id))
            {
                continue;
            }

            var participantId = string.IsNullOrWhiteSpace(item.ParticipantId) || !participantIds.Contains(item.ParticipantId)
                ? null
                : item.ParticipantId;

            ExecuteNonQuery(connection, transaction, """
                INSERT INTO loto_transactions (
                    id,
                    transaction_date,
                    type,
                    participant_id,
                    amount,
                    title,
                    payment_mode,
                    note,
                    created_at
                )
                VALUES (
                    @id,
                    @transaction_date,
                    @type,
                    @participant_id,
                    @amount,
                    @title,
                    @payment_mode,
                    @note,
                    @created_at
                );
                """, parameters =>
            {
                parameters.AddWithValue("id", item.Id);
                parameters.AddWithValue("transaction_date", ToDateTime(item.Date));
                parameters.AddWithValue("type", item.Type);
                parameters.AddWithValue("participant_id", participantId is null ? DBNull.Value : participantId);
                parameters.AddWithValue("amount", item.Amount);
                parameters.AddWithValue("title", item.Title);
                parameters.AddWithValue("payment_mode", item.PaymentMode);
                parameters.AddWithValue("note", item.Note);
                parameters.AddWithValue("created_at", item.CreatedAt.ToUniversalTime());
            });
        }

        var savedDrawDates = new HashSet<DateOnly>();
        foreach (var draw in state.AppliedDraws)
        {
            if (!savedDrawDates.Add(draw.Date))
            {
                continue;
            }

            ExecuteNonQuery(connection, transaction, """
                INSERT INTO loto_applied_draws (draw_date, paid_by, amount, created_at, created_by)
                VALUES (@draw_date, @paid_by, @amount, @created_at, @created_by);
                """, parameters =>
            {
                parameters.AddWithValue("draw_date", ToDateTime(draw.Date));
                parameters.AddWithValue("paid_by", draw.PaidBy);
                parameters.AddWithValue("amount", draw.Amount);
                parameters.AddWithValue("created_at", draw.CreatedAt.ToUniversalTime());
                parameters.AddWithValue("created_by", draw.CreatedBy);
            });
        }

        transaction.Commit();
    }

    private NpgsqlConnection OpenConnection()
    {
        var connection = new NpgsqlConnection(_connectionString);
        connection.Open();
        return connection;
    }

    private void EnsureSchema(NpgsqlConnection connection)
    {
        if (_schemaReady)
        {
            return;
        }

        lock (_schemaGate)
        {
            if (_schemaReady)
            {
                return;
            }

            ExecuteNonQuery(connection, null, """
                CREATE TABLE IF NOT EXISTS loto_settings (
                    id integer PRIMARY KEY CHECK (id = 1),
                    group_name text NOT NULL,
                    draw_cost_per_participant numeric(12,2) NOT NULL,
                    deduction_days_json text NOT NULL,
                    automation_start_date date NOT NULL,
                    automation_enabled boolean NOT NULL,
                    admin_pin text NOT NULL,
                    last_updated_at timestamptz NOT NULL
                );

                CREATE TABLE IF NOT EXISTS loto_participants (
                    id text PRIMARY KEY,
                    name text NOT NULL,
                    active boolean NOT NULL,
                    sort_order integer NOT NULL DEFAULT 0,
                    created_at timestamptz NOT NULL DEFAULT now()
                );

                CREATE TABLE IF NOT EXISTS loto_transactions (
                    id text PRIMARY KEY,
                    transaction_date date NOT NULL,
                    type text NOT NULL,
                    participant_id text NULL REFERENCES loto_participants(id) ON DELETE SET NULL,
                    amount numeric(12,2) NOT NULL,
                    title text NOT NULL,
                    payment_mode text NOT NULL,
                    note text NOT NULL,
                    created_at timestamptz NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_loto_transactions_participant
                    ON loto_transactions(participant_id);

                CREATE INDEX IF NOT EXISTS idx_loto_transactions_date
                    ON loto_transactions(transaction_date DESC, created_at DESC);

                CREATE TABLE IF NOT EXISTS loto_applied_draws (
                    draw_date date PRIMARY KEY,
                    paid_by text NOT NULL,
                    amount numeric(12,2) NOT NULL,
                    created_at timestamptz NOT NULL,
                    created_by text NOT NULL
                );

                CREATE TABLE IF NOT EXISTS loto_state_snapshots (
                    id bigserial PRIMARY KEY,
                    created_at timestamptz NOT NULL,
                    reason text NOT NULL,
                    payload jsonb NOT NULL
                );
                """);

            ExecuteNonQuery(connection, null, """
                ALTER TABLE loto_settings
                    ADD COLUMN IF NOT EXISTS group_name text NOT NULL DEFAULT 'Equipe B Moulage - Loto-Max CEZinc',
                    ADD COLUMN IF NOT EXISTS draw_cost_per_participant numeric(12,2) NOT NULL DEFAULT 6.00,
                    ADD COLUMN IF NOT EXISTS deduction_days_json text NOT NULL DEFAULT '["Tuesday","Friday"]',
                    ADD COLUMN IF NOT EXISTS automation_start_date date NOT NULL DEFAULT DATE '2026-06-24',
                    ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT true,
                    ADD COLUMN IF NOT EXISTS admin_pin text NOT NULL DEFAULT '2468',
                    ADD COLUMN IF NOT EXISTS last_updated_at timestamptz NOT NULL DEFAULT now();

                ALTER TABLE loto_participants
                    ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Participant',
                    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
                    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

                ALTER TABLE loto_transactions
                    ADD COLUMN IF NOT EXISTS transaction_date date NOT NULL DEFAULT current_date,
                    ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'correction',
                    ADD COLUMN IF NOT EXISTS participant_id text NULL,
                    ADD COLUMN IF NOT EXISTS amount numeric(12,2) NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT 'Transaction',
                    ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'Admin',
                    ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

                ALTER TABLE loto_applied_draws
                    ADD COLUMN IF NOT EXISTS paid_by text NOT NULL DEFAULT 'participants',
                    ADD COLUMN IF NOT EXISTS amount numeric(12,2) NOT NULL DEFAULT 0,
                    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
                    ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'system';

                ALTER TABLE loto_state_snapshots
                    ADD COLUMN IF NOT EXISTS id bigserial,
                    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
                    ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'migration',
                    ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

                UPDATE loto_settings
                SET
                    group_name = COALESCE(group_name, 'Equipe B Moulage - Loto-Max CEZinc'),
                    draw_cost_per_participant = COALESCE(draw_cost_per_participant, 6.00),
                    deduction_days_json = COALESCE(deduction_days_json, '["Tuesday","Friday"]'),
                    automation_start_date = COALESCE(automation_start_date, DATE '2026-06-24'),
                    automation_enabled = COALESCE(automation_enabled, true),
                    admin_pin = COALESCE(admin_pin, '2468'),
                    last_updated_at = COALESCE(last_updated_at, now());

                UPDATE loto_participants
                SET
                    name = COALESCE(name, 'Participant'),
                    active = COALESCE(active, true),
                    sort_order = COALESCE(sort_order, 0),
                    created_at = COALESCE(created_at, now());

                UPDATE loto_transactions
                SET
                    transaction_date = COALESCE(transaction_date, current_date),
                    type = COALESCE(type, 'correction'),
                    amount = COALESCE(amount, 0),
                    title = COALESCE(title, 'Transaction'),
                    payment_mode = COALESCE(payment_mode, 'Admin'),
                    note = COALESCE(note, ''),
                    created_at = COALESCE(created_at, now());

                UPDATE loto_applied_draws
                SET
                    paid_by = COALESCE(paid_by, 'participants'),
                    amount = COALESCE(amount, 0),
                    created_at = COALESCE(created_at, now()),
                    created_by = COALESCE(created_by, 'system');
                """);

            _schemaReady = true;
        }
    }

    private LotoState? LoadCore(NpgsqlConnection connection, NpgsqlTransaction? transaction)
    {
        LotoState? state = null;

        using (var command = new NpgsqlCommand("""
            SELECT
                group_name,
                draw_cost_per_participant,
                deduction_days_json,
                automation_start_date,
                automation_enabled,
                admin_pin,
                last_updated_at
            FROM loto_settings
            WHERE id = 1;
            """, connection, transaction))
        using (var reader = command.ExecuteReader())
        {
            if (!reader.Read())
            {
                return null;
            }

            var deductionDays = ReadDeductionDays(ReadString(reader, 2, """["Tuesday","Friday"]"""));
            state = new LotoState(
                ReadString(reader, 0, "Equipe B Moulage - Loto-Max CEZinc"),
                new LotoSettings(
                    reader.GetDecimal(1),
                    deductionDays,
                    ToDateOnly(reader.GetDateTime(3)),
                    reader.GetBoolean(4),
                    ReadString(reader, 5, "2468")),
                new List<LotoParticipant>(),
                new List<LotoTransaction>(),
                new List<AppliedDraw>(),
                ToDateTimeOffset(reader.GetValue(6)));
        }

        using (var command = new NpgsqlCommand("""
            SELECT id, name, active
            FROM loto_participants
            ORDER BY sort_order, name;
            """, connection, transaction))
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                state.Participants.Add(new LotoParticipant(
                    reader.GetString(0),
                    ReadString(reader, 1, "Participant"),
                    reader.GetBoolean(2)));
            }
        }

        using (var command = new NpgsqlCommand("""
            SELECT
                id,
                transaction_date,
                type,
                participant_id,
                amount,
                title,
                payment_mode,
                note,
                created_at
            FROM loto_transactions
            ORDER BY created_at DESC;
            """, connection, transaction))
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                state.Transactions.Add(new LotoTransaction(
                    reader.GetString(0),
                    ToDateOnly(reader.GetDateTime(1)),
                    ReadString(reader, 2, "correction"),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.GetDecimal(4),
                    ReadString(reader, 5, "Transaction"),
                    ReadString(reader, 6, "Admin"),
                    ReadString(reader, 7, ""),
                    ToDateTimeOffset(reader.GetValue(8))));
            }
        }

        using (var command = new NpgsqlCommand("""
            SELECT draw_date, paid_by, amount, created_at, created_by
            FROM loto_applied_draws
            ORDER BY draw_date DESC;
            """, connection, transaction))
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read())
            {
                state.AppliedDraws.Add(new AppliedDraw(
                    ToDateOnly(reader.GetDateTime(0)),
                    ReadString(reader, 1, "participants"),
                    reader.GetDecimal(2),
                    ToDateTimeOffset(reader.GetValue(3)),
                    ReadString(reader, 4, "system")));
            }
        }

        return state;
    }

    private void SaveSnapshot(NpgsqlConnection connection, NpgsqlTransaction transaction, LotoState state, string reason)
    {
        ExecuteNonQuery(connection, transaction, """
            INSERT INTO loto_state_snapshots (created_at, reason, payload)
            VALUES (@created_at, @reason, CAST(@payload AS jsonb));
            """, parameters =>
        {
            parameters.AddWithValue("created_at", LotoClock.Now.ToUniversalTime());
            parameters.AddWithValue("reason", string.IsNullOrWhiteSpace(reason) ? "save" : reason);
            parameters.AddWithValue("payload", JsonSerializer.Serialize(state, _snapshotOptions));
        });
    }

    private static void ExecuteNonQuery(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string sql,
        Action<NpgsqlParameterCollection>? bind = null)
    {
        using var command = new NpgsqlCommand(sql, connection, transaction);
        bind?.Invoke(command.Parameters);
        command.ExecuteNonQuery();
    }

    private static string ToNpgsqlConnectionString(string rawConnectionString)
    {
        if (!rawConnectionString.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase) &&
            !rawConnectionString.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase))
        {
            var rawBuilder = new NpgsqlConnectionStringBuilder(rawConnectionString);
            ApplyConnectionDefaults(rawBuilder);
            return rawBuilder.ConnectionString;
        }

        var uri = new Uri(rawConnectionString);
        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = credentials.Length > 0 ? Uri.UnescapeDataString(credentials[0]) : "",
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : "",
            SslMode = SslMode.Require
        };

        ApplyConnectionDefaults(builder);
        return builder.ConnectionString;
    }

    private static void ApplyConnectionDefaults(NpgsqlConnectionStringBuilder builder)
    {
        builder.Pooling = true;
        builder.MinPoolSize = 0;
        builder.MaxPoolSize = Math.Min(builder.MaxPoolSize, 5);
        builder.ConnectionIdleLifetime = Math.Min(builder.ConnectionIdleLifetime, 60);
        builder.Timeout = Math.Min(builder.Timeout, 10);
        builder.CommandTimeout = Math.Min(builder.CommandTimeout, 15);
        builder.KeepAlive = Math.Max(builder.KeepAlive, 30);
    }

    private static DateTime ToDateTime(DateOnly date) => date.ToDateTime(TimeOnly.MinValue);

    private static DateOnly ToDateOnly(DateTime date) => DateOnly.FromDateTime(date);

    private static DateTimeOffset ToDateTimeOffset(object value) =>
        value switch
        {
            DateTimeOffset offset => offset,
            DateTime date => new DateTimeOffset(DateTime.SpecifyKind(date, DateTimeKind.Utc)),
            _ => DateTimeOffset.Parse(Convert.ToString(value, CultureInfo.InvariantCulture) ?? "")
        };

    private static string ReadString(NpgsqlDataReader reader, int ordinal, string fallback) =>
        reader.IsDBNull(ordinal) ? fallback : reader.GetString(ordinal);

    private static List<string> ReadDeductionDays(string value)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(value)?.Count > 0
                ? JsonSerializer.Deserialize<List<string>>(value)!
                : new List<string> { "Tuesday", "Friday" };
        }
        catch (JsonException)
        {
            return new List<string> { "Tuesday", "Friday" };
        }
    }
}

public static class LotoClock
{
    private static readonly TimeZoneInfo EasternTimeZone = ResolveEasternTimeZone();

    public static DateTimeOffset Now => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, EasternTimeZone);

    public static DateOnly Today => DateOnly.FromDateTime(Now.DateTime);

    public static string TimeZoneId => EasternTimeZone.Id;

    private static TimeZoneInfo ResolveEasternTimeZone()
    {
        foreach (var id in new[] { "America/Toronto", "Eastern Standard Time" })
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return TimeZoneInfo.Local;
    }
}

public sealed class LotoException(string message) : Exception(message);

public sealed record LotoState(
    string GroupName,
    LotoSettings Settings,
    List<LotoParticipant> Participants,
    List<LotoTransaction> Transactions,
    List<AppliedDraw> AppliedDraws,
    DateTimeOffset LastUpdatedAt);

public sealed record LotoSettings(
    decimal DrawCostPerParticipant,
    List<string> DeductionDays,
    DateOnly AutomationStartDate,
    bool AutomationEnabled,
    string AdminPin);

public sealed record LotoParticipant(string Id, string Name, bool Active);

public sealed record LotoTransaction(
    string Id,
    DateOnly Date,
    string Type,
    string? ParticipantId,
    decimal Amount,
    string Title,
    string PaymentMode,
    string Note,
    DateTimeOffset CreatedAt);

public sealed record AppliedDraw(DateOnly Date, string PaidBy, decimal Amount, DateTimeOffset CreatedAt, string CreatedBy);

public sealed record TransactionRequest(
    string Type,
    string? ParticipantId,
    decimal Amount,
    DateOnly? Date,
    string? PaymentMode,
    string? Note,
    string? AdminPin);

public sealed record ParticipantRequest(
    string? Name,
    decimal? OpeningBalance,
    DateOnly? Date,
    bool? Active,
    string? PaymentMode,
    string? Note,
    string? AdminPin);

public sealed record ParticipantStatusRequest(string? ParticipantId, bool Active, string? AdminPin);

public sealed record ParticipantDeleteRequest(string? ParticipantId, string? AdminPin);

public sealed record DrawRequest(DateOnly? Date, string? AdminPin);

public sealed record AdminRequest(string? AdminPin);

public sealed record LotoView(
    string GroupName,
    DateTimeOffset LastUpdatedAt,
    decimal DrawCostPerParticipant,
    List<string> DeductionDays,
    bool AutomationEnabled,
    List<ParticipantView> Participants,
    decimal GroupWins,
    decimal ParticipantTotal,
    decimal GroupTotal,
    decimal DrawTotal,
    int PaidDraws,
    decimal WinsRemainder,
    NextDrawView NextDraw,
    List<HistoryEntryView> GroupHistory);

public sealed record ParticipantView(
    string Id,
    string Name,
    bool Active,
    decimal Balance,
    int CoveredDraws,
    decimal Remainder,
    List<HistoryEntryView> History);

public sealed record HistoryEntryView(DateOnly Date, decimal Amount, string Title, string Meta);

public sealed record NextDrawView(DateOnly Date, bool CoveredByGains, decimal MissingAmount, decimal RemainderAfterPayment);
