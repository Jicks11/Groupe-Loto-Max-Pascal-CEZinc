using System.Text.Json;
using Microsoft.Extensions.FileProviders;

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
app.MapGet("/api/health", () => Results.Ok(new { status = "ok", checkedAt = DateTimeOffset.Now }));
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
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public LotoView GetView()
    {
        lock (_gate)
        {
            var state = Load();
            var changed = ProcessDueDraws(state, DateOnly.FromDateTime(DateTime.Now));
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
            var state = Load();
            ValidateAdmin(state, request.AdminPin);

            var date = request.Date ?? DateOnly.FromDateTime(DateTime.Now);
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
            else
            {
                var participant = FindParticipant(state, request.ParticipantId);
                var transactionAmount = type == "correction" ? amount : Math.Abs(amount);
                var title = type == "correction" ? "Correction" : "Depot";
                var transactionType = type == "correction" ? "correction" : "deposit";

                state.Transactions.Insert(0, NewTransaction(
                    date,
                    transactionType,
                    participant.Id,
                    transactionAmount,
                    title,
                    request.PaymentMode,
                    request.Note));
            }

            state = state with { LastUpdatedAt = DateTimeOffset.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView ApplyManualDraw(DrawRequest request)
    {
        lock (_gate)
        {
            var state = Load();
            ValidateAdmin(state, request.AdminPin);
            var date = request.Date ?? NextDueDate(state, DateOnly.FromDateTime(DateTime.Now));
            ApplyDraw(state, date, "manuel");
            state = state with { LastUpdatedAt = DateTimeOffset.Now };
            Save(state);
            return BuildView(state);
        }
    }

    public LotoView Reseed(AdminRequest request)
    {
        lock (_gate)
        {
            var current = Load();
            ValidateAdmin(current, request.AdminPin);
            var seed = SeedState();
            Save(seed);
            return BuildView(seed);
        }
    }

    public void CheckAdmin(AdminRequest request)
    {
        lock (_gate)
        {
            ValidateAdmin(Load(), request.AdminPin);
        }
    }

    public void ProcessDueDraws()
    {
        lock (_gate)
        {
            var state = Load();
            var changed = ProcessDueDraws(state, DateOnly.FromDateTime(DateTime.Now));
            if (changed)
            {
                state = state with { LastUpdatedAt = DateTimeOffset.Now };
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
                "Tirage paye par Nos gains",
                "Nos gains",
                $"{activeParticipants.Count} participants proteges"));

            state.AppliedDraws.Insert(0, new AppliedDraw(date, "gains", drawTotal, DateTimeOffset.Now, createdBy));
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

        state.AppliedDraws.Insert(0, new AppliedDraw(date, "participants", drawTotal, DateTimeOffset.Now, createdBy));
    }

    private LotoState Load()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dataPath)!);
        if (!File.Exists(_dataPath))
        {
            var seed = SeedState();
            Save(seed);
            return seed;
        }

        var json = File.ReadAllText(_dataPath);
        return JsonSerializer.Deserialize<LotoState>(json, _jsonOptions) ?? SeedState();
    }

    private void Save(LotoState state)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dataPath)!);
        var json = JsonSerializer.Serialize(state, _jsonOptions);
        File.WriteAllText(_dataPath, json);
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
        var nextDate = NextDueDate(state, DateOnly.FromDateTime(DateTime.Now));
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
            .OrderByDescending(transaction => transaction.Date)
            .ThenByDescending(transaction => transaction.CreatedAt)
            .Take(25)
            .Select(ToHistoryEntry)
            .ToList();

    private List<HistoryEntryView> GroupHistory(LotoState state) =>
        state.Transactions
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
            DateTimeOffset.Now);

    private void ValidateAdmin(LotoState state, string? adminPin)
    {
        var expectedPin = string.IsNullOrWhiteSpace(_adminPin) ? state.Settings.AdminPin : _adminPin;
        if (string.IsNullOrWhiteSpace(expectedPin) || adminPin != expectedPin)
        {
            throw new LotoException("PIN admin invalide.");
        }
    }

    private static LotoState SeedState()
    {
        var now = DateTimeOffset.Now;
        var today = DateOnly.FromDateTime(DateTime.Now);
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
            "Nos gains disponibles",
            "Excel",
            "Import initial du groupe",
            now));

        return new LotoState(
            "Equipe B Loto Max",
            new LotoSettings(6, new List<string> { "Thursday", "Sunday" }, today, true, "2468"),
            participants,
            transactions,
            new List<AppliedDraw>(),
            now);
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
