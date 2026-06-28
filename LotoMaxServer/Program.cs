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
builder.Services.AddSingleton<LotoGroupRegistry>();
builder.Services.AddHostedService<DrawScheduler>();
builder.Services.AddCors(options =>
{
    options.AddPolicy("CloudflarePagesFrontend", policy =>
    {
        policy
            .SetIsOriginAllowed(origin =>
            {
                if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
                {
                    return false;
                }

                var host = uri.Host.ToLowerInvariant();
                return host == "groupe-loto-max-pascal-cezinc.onrender.com" ||
                    host == "localhost" ||
                    host == "127.0.0.1" ||
                    host.EndsWith(".pages.dev", StringComparison.OrdinalIgnoreCase) ||
                    host.EndsWith(".workers.dev", StringComparison.OrdinalIgnoreCase);
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors("CloudflarePagesFrontend");
var configuredLotoMaxRoot = Environment.GetEnvironmentVariable("LOTOMAX_STATIC_ROOT");
var lotoMaxRoot = Path.GetFullPath(string.IsNullOrWhiteSpace(configuredLotoMaxRoot)
    ? Path.Combine(app.Environment.ContentRootPath, "..", "loto-max")
    : configuredLotoMaxRoot);
var configuredLoto649Root = Environment.GetEnvironmentVariable("LOTO649_STATIC_ROOT");
var loto649Root = Path.GetFullPath(string.IsNullOrWhiteSpace(configuredLoto649Root)
    ? Path.Combine(app.Environment.ContentRootPath, "..", "loto-649")
    : configuredLoto649Root);

app.MapGet("/", () => Results.Content(File.ReadAllText(Path.Combine(lotoMaxRoot, "index.html")), "text/html; charset=utf-8"));
app.MapGet("/api/health", (LotoGroupRegistry groups) => Results.Ok(new
{
    status = "ok",
    checkedAt = LotoClock.Now,
    timeZone = LotoClock.TimeZoneId,
    groups = groups.Stores.Select(store => new { store.GroupId, storage = store.StorageMode })
}));
app.MapGet("/loto-max/", () => Results.Content(File.ReadAllText(Path.Combine(lotoMaxRoot, "index.html")), "text/html; charset=utf-8"));
app.MapGet("/loto-649/", () => Results.Content(File.ReadAllText(Path.Combine(loto649Root, "index.html")), "text/html; charset=utf-8"));
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(lotoMaxRoot),
    RequestPath = "/loto-max"
});
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(loto649Root),
    RequestPath = "/loto-649"
});

MapLotoApi(app.MapGroup("/api"), registry => registry.LotoMax);
MapLotoApi(app.MapGroup("/api/loto-max"), registry => registry.LotoMax);
MapLotoApi(app.MapGroup("/api/loto-649"), registry => registry.Loto649);

app.Run();

static void MapLotoApi(RouteGroupBuilder api, Func<LotoGroupRegistry, LotoStore> getStore)
{
    api.MapGet("/state", (LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).GetView());
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
        catch (Exception exception)
        {
            return Results.BadRequest(new { error = $"Erreur technique pendant le chargement: {exception.Message}" });
        }
    });

    api.MapPost("/transactions", (TransactionRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).AddTransaction(request));
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

    api.MapPost("/participants", (ParticipantRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).AddParticipant(request));
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

    api.MapPost("/participants/status", (ParticipantStatusRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).SetParticipantActive(request));
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });

    api.MapPost("/participants/delete", (ParticipantDeleteRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).DeleteParticipant(request));
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });

    api.MapPost("/draws/apply", (DrawRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).ApplyManualDraw(request));
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });

    api.MapPost("/draws/participants", (DrawRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).ApplyParticipantDraw(request));
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

    api.MapPost("/admin/reseed", (AdminRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).Reseed(request));
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });

    api.MapPost("/admin/clear-history", (AdminRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).ClearHistory(request));
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });

    api.MapPost("/admin/draw-info", (DrawInfoRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            return Results.Ok(getStore(registry).UpdateDrawInfo(request));
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
        catch (Exception exception)
        {
            return Results.BadRequest(new { error = $"Erreur technique pendant la mise a jour du tirage: {exception.Message}" });
        }
    });

    api.MapPost("/admin/check", (AdminRequest request, LotoGroupRegistry registry) =>
    {
        try
        {
            getStore(registry).CheckAdmin(request);
            return Results.Ok(new { ok = true });
        }
        catch (LotoException exception)
        {
            return Results.BadRequest(new { error = exception.Message });
        }
    });
}

public sealed class LotoGroupRegistry
{
    public LotoGroupRegistry(IHostEnvironment environment)
    {
        LotoMax = new LotoStore(environment, LotoGroupConfig.LotoMax());
        Loto649 = new LotoStore(environment, LotoGroupConfig.Loto649());
        Stores = new[] { LotoMax, Loto649 };
    }

    public LotoStore LotoMax { get; }

    public LotoStore Loto649 { get; }

    public IReadOnlyList<LotoStore> Stores { get; }
}

public sealed class DrawScheduler(LotoGroupRegistry groups, ILogger<DrawScheduler> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Yield();

        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            foreach (var store in groups.Stores)
            {
                try
                {
                    store.ProcessDueDraws();
                }
                catch (Exception exception)
                {
                    logger.LogError(exception, "Erreur pendant le traitement automatique des tirages pour {GroupId}.", store.GroupId);
                }
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

public sealed record LotoParticipantSeed(string Id, string Name, decimal OpeningBalance);

public sealed record LotoGroupConfig(
    string GroupId,
    string TablePrefix,
    string DataPathEnvVar,
    string DefaultDataFileName,
    string AdminPinEnvVar,
    string DefaultGroupName,
    decimal DrawCostPerParticipant,
    List<string> DeductionDays,
    int PublicDrawDateOffsetDays,
    decimal OpeningGroupWins,
    string OpeningSource,
    List<LotoParticipantSeed> Participants)
{
    public static LotoGroupConfig LotoMax() => new(
        "loto-max",
        "loto",
        "LOTOMAX_DATA_PATH",
        "loto-max-state.json",
        "LOTOMAX_ADMIN_PIN",
        "Équipe B Moulage — Loto-Max CEZinc",
        6,
        new List<string> { "Wednesday", "Saturday" },
        -1,
        96,
        "Excel",
        new List<LotoParticipantSeed>
        {
            new("pascal-taillefer", "Pascal Taillefer", -6),
            new("etienne-berthiaume", "Etienne Berthiaume", 24),
            new("luc-arsenault", "Luc Arsenault", 55),
            new("christian-larochelle", "Christian Larochelle", 34),
            new("marc-leduc", "Marc Leduc", 34),
            new("steve-bertrand", "Steve Bertrand", 14),
            new("martine-hamel", "Martine Hamel", 5),
            new("keith-saulnier", "Keith Saulnier", -12),
            new("simon-prairie", "Simon Prairie", 4),
            new("jean-francois-durocher", "Jean-Francois Durocher", 4),
            new("alexandre-genest", "Alexandre Genest", 22),
            new("mario-dufresne", "Mario Dufresne", 55),
            new("roger-leclair", "Roger Leclair", 54)
        });

    public static LotoGroupConfig Loto649() => new(
        "loto-649",
        "loto649",
        "LOTO649_DATA_PATH",
        "loto-649-state.json",
        "LOTO649_ADMIN_PIN",
        "Famille Taillefer - 6/49",
        5,
        new List<string> { "Wednesday", "Saturday" },
        0,
        17,
        "Excel",
        new List<LotoParticipantSeed>
        {
            new("pascal-taillefer", "Pascal Taillefer", -5),
            new("serge-taillefer", "Serge Taillefer", 36),
            new("gaetane-taillefer", "Ga\u00e9tane Taillefer", 36),
            new("dominique-taillefer", "Dominique Taillefer", -12)
        });
}

public sealed class LotoStore
{
    private readonly IHostEnvironment _environment;
    private readonly LotoGroupConfig _config;
    private readonly object _gate = new();
    private readonly string _dataPath;
    private readonly string? _adminPin;
    private readonly LotoDatabase? _database;
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };
    private LotoState? _cachedState;
    private DateTimeOffset _lastDatabaseRefresh = DateTimeOffset.MinValue;
    private static readonly TimeSpan DatabaseRefreshInterval = TimeSpan.FromMinutes(5);

    public LotoStore(IHostEnvironment environment, LotoGroupConfig config)
    {
        _environment = environment;
        _config = config;
        _dataPath = Path.GetFullPath(string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(config.DataPathEnvVar))
            ? Path.Combine(environment.ContentRootPath, "..", "data", config.DefaultDataFileName)
            : Environment.GetEnvironmentVariable(config.DataPathEnvVar)!);
        _adminPin = Environment.GetEnvironmentVariable(config.AdminPinEnvVar)
            ?? Environment.GetEnvironmentVariable("LOTOMAX_ADMIN_PIN");
        _database = LotoDatabase.Create(config.TablePrefix, config.DefaultGroupName, config.DrawCostPerParticipant, config.DeductionDays);
    }

    public string GroupId => _config.GroupId;

    public string StorageMode => _database is null ? "file" : "postgres";

    public LotoView GetView()
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
            var now = LotoClock.Now;
            var today = DateOnly.FromDateTime(now.DateTime);
            var changed = ProcessDueDraws(state, today, now.TimeOfDay);
            if (changed)
            {
                state = state with { LastUpdatedAt = LotoClock.Now };
                Save(state, expectedLastUpdatedAt);
            }

            return BuildView(state);
        }
    }

    public LotoView AddTransaction(TransactionRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
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
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView AddParticipant(ParticipantRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
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
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView SetParticipantActive(ParticipantStatusRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
            ValidateAdmin(state, request.AdminPin);

            var index = state.Participants.FindIndex(participant => participant.Id == request.ParticipantId);
            if (index < 0)
            {
                throw new LotoException("Participant introuvable.");
            }

            state.Participants[index] = state.Participants[index] with { Active = request.Active };
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView DeleteParticipant(ParticipantDeleteRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
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
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView ApplyManualDraw(DrawRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
            ValidateAdmin(state, request.AdminPin);
            var date = request.Date ?? NextDueDate(state, LotoClock.Today);
            ApplyDraw(state, date, "manuel");
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView ApplyParticipantDraw(DrawRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
            ValidateAdmin(state, request.AdminPin);
            var date = request.Date ?? LotoClock.Today;
            ApplyParticipantDraw(state, date, "manuel");
            state = state with { LastUpdatedAt = LotoClock.Now };
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView Reseed(AdminRequest request)
    {
        lock (_gate)
        {
            var current = Load(useCache: false);
            var expectedLastUpdatedAt = current.LastUpdatedAt;
            ValidateAdmin(current, request.AdminPin);
            var seed = SeedState();
            Save(seed, expectedLastUpdatedAt);
            return BuildView(seed);
        }
    }

    public LotoView ClearHistory(AdminRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
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
            Save(state, expectedLastUpdatedAt);
            return BuildView(state);
        }
    }

    public LotoView UpdateDrawInfo(DrawInfoRequest request)
    {
        lock (_gate)
        {
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
            ValidateAdmin(state, request.AdminPin);

            var jackpotAmount = CleanDrawInfoText(request.JackpotAmount, 80);
            var secondaryPrizes = CleanDrawInfoText(request.SecondaryPrizes, 120);
            var now = LotoClock.Now;

            state = state with
            {
                Settings = state.Settings with
                {
                    JackpotAmount = jackpotAmount,
                    SecondaryPrizes = secondaryPrizes,
                    PrizeInfoUpdatedAt = now
                },
                LastUpdatedAt = now
            };
            Save(state, expectedLastUpdatedAt);
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
            var state = Load(useCache: false);
            var expectedLastUpdatedAt = state.LastUpdatedAt;
            var now = LotoClock.Now;
            var today = DateOnly.FromDateTime(now.DateTime);
            var changed = ProcessDueDraws(state, today, now.TimeOfDay);
            if (changed)
            {
                state = state with { LastUpdatedAt = LotoClock.Now };
                Save(state, expectedLastUpdatedAt);
            }
        }
    }

    private bool ProcessDueDraws(LotoState state, DateOnly today, TimeSpan currentTimeOfDay)
    {
        if (!state.Settings.AutomationEnabled)
        {
            return false;
        }

        var changed = false;
        var start = state.Settings.AutomationStartDate;
        var applyThrough = currentTimeOfDay < TimeSpan.FromMinutes(1) ? today.AddDays(-1) : today;
        for (var date = start; date <= applyThrough; date = date.AddDays(1))
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

                    if (NormalizeState(ref databaseState))
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
                if (!useCache)
                {
                    throw new LotoException("Impossible de charger les donnees officielles depuis Postgres. Reessaie dans quelques secondes.");
                }

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
        if (NormalizeState(ref state))
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

    private void Save(LotoState state, DateTimeOffset? expectedLastUpdatedAt = null)
    {
        if (state.Participants.Count == 0)
        {
            throw new LotoException("Protection des soldes: sauvegarde refusee car aucun participant n'est present.");
        }

        if (_database is not null)
        {
            _database.Save(state, "save", expectedLastUpdatedAt);
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

    private bool NormalizeState(ref LotoState state)
    {
        var changed = false;
        if (state.Settings.DrawCostPerParticipant != _config.DrawCostPerParticipant)
        {
            state = state with
            {
                Settings = state.Settings with { DrawCostPerParticipant = _config.DrawCostPerParticipant },
                LastUpdatedAt = LotoClock.Now
            };
            changed = true;
        }

        if (state.Settings.JackpotAmount is null ||
            state.Settings.SecondaryPrizes is null ||
            state.Settings.PrizeInfoUpdatedAt == default)
        {
            state = state with
            {
                Settings = state.Settings with
                {
                    JackpotAmount = state.Settings.JackpotAmount ?? "",
                    SecondaryPrizes = state.Settings.SecondaryPrizes ?? "",
                    PrizeInfoUpdatedAt = state.Settings.PrizeInfoUpdatedAt == default ? state.LastUpdatedAt : state.Settings.PrizeInfoUpdatedAt
                },
                LastUpdatedAt = LotoClock.Now
            };
            changed = true;
        }

        var days = state.Settings.DeductionDays;
        var expectedDays = _config.DeductionDays;
        var alreadyExpected =
            days.Count == expectedDays.Count &&
            expectedDays.All(expected => days.Any(day => string.Equals(day, expected, StringComparison.OrdinalIgnoreCase)));

        if (alreadyExpected)
        {
            return changed;
        }

        var shouldApplyConfiguredSchedule =
            string.Equals(_config.GroupId, "loto-max", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(_config.GroupId, "loto-649", StringComparison.OrdinalIgnoreCase);

        if (!shouldApplyConfiguredSchedule)
        {
            return changed;
        }

        if (MirrorAppliedDrawsForShiftedSchedule(state, days, expectedDays))
        {
            changed = true;
        }

        days.Clear();
        days.AddRange(expectedDays);
        return true;
    }

    private static bool MirrorAppliedDrawsForShiftedSchedule(LotoState state, List<string> previousDays, List<string> expectedDays)
    {
        var previousDaySet = ParseDays(previousDays);
        var expectedDaySet = ParseDays(expectedDays);
        if (previousDaySet.Count == 0 || expectedDaySet.Count == 0)
        {
            return false;
        }

        var changed = false;
        var existingDates = state.AppliedDraws.Select(draw => draw.Date).ToHashSet();
        foreach (var draw in state.AppliedDraws.ToList())
        {
            if (!previousDaySet.Contains(draw.Date.DayOfWeek))
            {
                continue;
            }

            var shiftedDate = draw.Date.AddDays(1);
            if (!expectedDaySet.Contains(shiftedDate.DayOfWeek) || existingDates.Contains(shiftedDate))
            {
                continue;
            }

            state.AppliedDraws.Insert(0, draw with { Date = shiftedDate });
            existingDates.Add(shiftedDate);
            changed = true;
        }

        return changed;
    }

    private static HashSet<DayOfWeek> ParseDays(IEnumerable<string> days)
    {
        var parsedDays = new HashSet<DayOfWeek>();
        foreach (var day in days)
        {
            if (Enum.TryParse<DayOfWeek>(day, true, out var parsed))
            {
                parsedDays.Add(parsed);
            }
        }

        return parsedDays;
    }

    private static string CleanDrawInfoText(string? value, int maxLength)
    {
        var text = (value ?? "").Trim();
        if (text.Length > maxLength)
        {
            throw new LotoException($"Le texte est trop long. Maximum: {maxLength} caracteres.");
        }

        return text;
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
                var paymentRequiredDate = participant.Active
                    ? (DateOnly?)PaymentRequiredDate(state, LotoClock.Today, coveredDraws)
                    : null;
                var history = ParticipantHistory(state, participant.Id);
                return new ParticipantView(
                    participant.Id,
                    participant.Name,
                    participant.Active,
                    balance,
                    coveredDraws,
                    remainder,
                    paymentRequiredDate,
                    history);
            })
            .ToList();
        var participantTotal = participants.Sum(participant => participant.Balance);
        var paidDraws = drawTotal > 0 ? (int)Math.Floor(groupWins / drawTotal) : 0;
        var winsRemainder = drawTotal > 0 ? groupWins % drawTotal : 0;
        var nextDate = NextDueDate(state, LotoClock.Today);
        var publicDrawDate = nextDate.AddDays(_config.PublicDrawDateOffsetDays);
        var missing = Math.Max(0, drawTotal - groupWins);
        var nextDraw = new NextDrawView(nextDate, groupWins >= drawTotal, missing, winsRemainder);
        var prizeInfo = new PrizeInfoView(
            publicDrawDate,
            state.Settings.JackpotAmount,
            state.Settings.SecondaryPrizes,
            state.Settings.PrizeInfoUpdatedAt);

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
            prizeInfo,
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

    private static DateOnly PaymentRequiredDate(LotoState state, DateOnly fromDate, int coveredDraws)
    {
        var uncoveredDrawIndex = Math.Max(0, coveredDraws);
        var seenDraws = 0;

        for (var offset = 0; offset <= 730; offset++)
        {
            var date = fromDate.AddDays(offset);
            if (!IsDeductionDay(state, date) || IsDrawApplied(state, date))
            {
                continue;
            }

            if (seenDraws == uncoveredDrawIndex)
            {
                return date;
            }

            seenDraws++;
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

    private LotoState SeedState()
    {
        var now = LotoClock.Now;
        var today = LotoClock.Today;
        var participants = _config.Participants
            .Select(participant => new LotoParticipant(participant.Id, participant.Name, true))
            .ToList();

        var transactions = _config.Participants
            .Where(participant => participant.OpeningBalance != 0)
            .Select(participant => new LotoTransaction(
                Guid.NewGuid().ToString("N"),
                today,
                "opening",
                participant.Id,
                participant.OpeningBalance,
                "Solde importe",
                _config.OpeningSource,
                "Import initial du groupe",
                now))
            .ToList();

        if (_config.OpeningGroupWins != 0)
        {
            transactions.Insert(0, new LotoTransaction(
                Guid.NewGuid().ToString("N"),
                today,
                "gain",
                null,
                _config.OpeningGroupWins,
                "nos gains disponibles",
                _config.OpeningSource,
                "Import initial du groupe",
                now));
        }

        return new LotoState(
            _config.DefaultGroupName,
            new LotoSettings(_config.DrawCostPerParticipant, new List<string>(_config.DeductionDays), today, true, "2468", "", "", now),
            participants,
            transactions,
            new List<AppliedDraw>(),
            now);
    }
}

public sealed class LotoDatabase
{
    private readonly string _connectionString;
    private readonly string _tablePrefix;
    private readonly string _defaultGroupName;
    private readonly decimal _defaultDrawCost;
    private readonly List<string> _defaultDeductionDays;
    private readonly object _schemaGate = new();
    private bool _schemaReady;
    private readonly JsonSerializerOptions _snapshotOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    private LotoDatabase(string connectionString, string tablePrefix, string defaultGroupName, decimal defaultDrawCost, List<string> defaultDeductionDays)
    {
        _connectionString = connectionString;
        _tablePrefix = tablePrefix;
        _defaultGroupName = defaultGroupName;
        _defaultDrawCost = defaultDrawCost;
        _defaultDeductionDays = new List<string>(defaultDeductionDays);
    }

    public static LotoDatabase? Create(string tablePrefix, string defaultGroupName, decimal defaultDrawCost, List<string> defaultDeductionDays)
    {
        var rawConnectionString =
            Environment.GetEnvironmentVariable("SUPABASE_DB_CONNECTION") ??
            Environment.GetEnvironmentVariable("DATABASE_URL") ??
            Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING");

        if (string.IsNullOrWhiteSpace(rawConnectionString))
        {
            return null;
        }

        if (!tablePrefix.All(character => char.IsLetterOrDigit(character) || character == '_'))
        {
            throw new InvalidOperationException("Prefixe de table invalide.");
        }

        return new LotoDatabase(ToNpgsqlConnectionString(rawConnectionString), tablePrefix, defaultGroupName, defaultDrawCost, defaultDeductionDays);
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

        using var command = new NpgsqlCommand(Sql("""
            SELECT payload::text
            FROM loto_state_snapshots
            ORDER BY created_at DESC, id DESC
            LIMIT 50;
            """), connection);
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

    public void Save(LotoState state, string reason, DateTimeOffset? expectedLastUpdatedAt = null)
    {
        using var connection = OpenConnection();
        EnsureSchema(connection);
        using var transaction = connection.BeginTransaction();

        var existing = LoadCore(connection, transaction);
        if (existing is not null)
        {
            if (expectedLastUpdatedAt is not null &&
                existing.LastUpdatedAt.ToUniversalTime() > expectedLastUpdatedAt.Value.ToUniversalTime().AddMilliseconds(1))
            {
                throw new LotoException("Les donnees ont change pendant l'operation. Recharge la page et recommence pour eviter d'ecraser un depot recent.");
            }

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
                jackpot_amount,
                secondary_prizes,
                prize_info_updated_at,
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
                @jackpot_amount,
                @secondary_prizes,
                @prize_info_updated_at,
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
            parameters.AddWithValue("jackpot_amount", state.Settings.JackpotAmount);
            parameters.AddWithValue("secondary_prizes", state.Settings.SecondaryPrizes);
            parameters.AddWithValue("prize_info_updated_at", state.Settings.PrizeInfoUpdatedAt.ToUniversalTime());
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

            var defaultGroupNameSql = EscapeSqlLiteral(_defaultGroupName);
            var defaultDrawCostSql = _defaultDrawCost.ToString(CultureInfo.InvariantCulture);
            var defaultDeductionDaysSql = EscapeSqlLiteral(JsonSerializer.Serialize(_defaultDeductionDays));

            ExecuteNonQuery(connection, null, """
                CREATE TABLE IF NOT EXISTS loto_settings (
                    id integer PRIMARY KEY CHECK (id = 1),
                    group_name text NOT NULL,
                    draw_cost_per_participant numeric(12,2) NOT NULL,
                    deduction_days_json text NOT NULL,
                    automation_start_date date NOT NULL,
                    automation_enabled boolean NOT NULL,
                    admin_pin text NOT NULL,
                    jackpot_amount text NOT NULL DEFAULT '',
                    secondary_prizes text NOT NULL DEFAULT '',
                    prize_info_updated_at timestamptz NOT NULL DEFAULT now(),
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

            ExecuteNonQuery(connection, null, $"""
                ALTER TABLE loto_settings
                    ADD COLUMN IF NOT EXISTS group_name text NOT NULL DEFAULT '{defaultGroupNameSql}',
                    ADD COLUMN IF NOT EXISTS draw_cost_per_participant numeric(12,2) NOT NULL DEFAULT {defaultDrawCostSql},
                    ADD COLUMN IF NOT EXISTS deduction_days_json text NOT NULL DEFAULT '{defaultDeductionDaysSql}',
                    ADD COLUMN IF NOT EXISTS automation_start_date date NOT NULL DEFAULT DATE '2026-06-24',
                    ADD COLUMN IF NOT EXISTS automation_enabled boolean NOT NULL DEFAULT true,
                    ADD COLUMN IF NOT EXISTS admin_pin text NOT NULL DEFAULT '2468',
                    ADD COLUMN IF NOT EXISTS jackpot_amount text NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS secondary_prizes text NOT NULL DEFAULT '',
                    ADD COLUMN IF NOT EXISTS prize_info_updated_at timestamptz NOT NULL DEFAULT now(),
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
                    ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT jsonb_build_object();

                UPDATE loto_settings
                SET
                    group_name = COALESCE(group_name, '{defaultGroupNameSql}'),
                    draw_cost_per_participant = COALESCE(draw_cost_per_participant, {defaultDrawCostSql}),
                    deduction_days_json = COALESCE(deduction_days_json, '{defaultDeductionDaysSql}'),
                    automation_start_date = COALESCE(automation_start_date, DATE '2026-06-24'),
                    automation_enabled = COALESCE(automation_enabled, true),
                    admin_pin = COALESCE(admin_pin, '2468'),
                    jackpot_amount = COALESCE(jackpot_amount, ''),
                    secondary_prizes = COALESCE(secondary_prizes, ''),
                    prize_info_updated_at = COALESCE(prize_info_updated_at, last_updated_at, now()),
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

        using (var command = new NpgsqlCommand(Sql("""
            SELECT
                group_name,
                draw_cost_per_participant,
                deduction_days_json,
                automation_start_date,
                automation_enabled,
                admin_pin,
                jackpot_amount,
                secondary_prizes,
                prize_info_updated_at,
                last_updated_at
            FROM loto_settings
            WHERE id = 1;
            """), connection, transaction))
        using (var reader = command.ExecuteReader())
        {
            if (!reader.Read())
            {
                return null;
            }

            var deductionDays = ReadDeductionDays(
                ReadString(reader, 2, JsonSerializer.Serialize(_defaultDeductionDays)),
                _defaultDeductionDays);
            state = new LotoState(
                ReadString(reader, 0, _defaultGroupName),
                new LotoSettings(
                    reader.GetDecimal(1),
                    deductionDays,
                    ToDateOnly(reader.GetDateTime(3)),
                    reader.GetBoolean(4),
                    ReadString(reader, 5, "2468"),
                    ReadString(reader, 6, ""),
                    ReadString(reader, 7, ""),
                    ToDateTimeOffset(reader.GetValue(8))),
                new List<LotoParticipant>(),
                new List<LotoTransaction>(),
                new List<AppliedDraw>(),
                ToDateTimeOffset(reader.GetValue(9)));
        }

        using (var command = new NpgsqlCommand(Sql("""
            SELECT id, name, active
            FROM loto_participants
            ORDER BY sort_order, name;
            """), connection, transaction))
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

        using (var command = new NpgsqlCommand(Sql("""
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
            """), connection, transaction))
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

        using (var command = new NpgsqlCommand(Sql("""
            SELECT draw_date, paid_by, amount, created_at, created_by
            FROM loto_applied_draws
            ORDER BY draw_date DESC;
            """), connection, transaction))
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

    private string Sql(string sql) => sql
        .Replace("loto_state_snapshots", $"{_tablePrefix}_state_snapshots", StringComparison.Ordinal)
        .Replace("loto_applied_draws", $"{_tablePrefix}_applied_draws", StringComparison.Ordinal)
        .Replace("loto_transactions", $"{_tablePrefix}_transactions", StringComparison.Ordinal)
        .Replace("loto_participants", $"{_tablePrefix}_participants", StringComparison.Ordinal)
        .Replace("loto_settings", $"{_tablePrefix}_settings", StringComparison.Ordinal);

    private static string EscapeSqlLiteral(string value) => value.Replace("'", "''", StringComparison.Ordinal);

    private void ExecuteNonQuery(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        string sql,
        Action<NpgsqlParameterCollection>? bind = null)
    {
        using var command = new NpgsqlCommand(Sql(sql), connection, transaction);
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

    private static List<string> ReadDeductionDays(string value, List<string> fallback)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(value)?.Count > 0
                ? JsonSerializer.Deserialize<List<string>>(value)!
                : new List<string>(fallback);
        }
        catch (JsonException)
        {
            return new List<string>(fallback);
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
    string AdminPin,
    string JackpotAmount,
    string SecondaryPrizes,
    DateTimeOffset PrizeInfoUpdatedAt);

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

public sealed record DrawInfoRequest(string? JackpotAmount, string? SecondaryPrizes, string? AdminPin);

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
    PrizeInfoView PrizeInfo,
    List<HistoryEntryView> GroupHistory);

public sealed record ParticipantView(
    string Id,
    string Name,
    bool Active,
    decimal Balance,
    int CoveredDraws,
    decimal Remainder,
    DateOnly? PaymentRequiredDate,
    List<HistoryEntryView> History);

public sealed record HistoryEntryView(DateOnly Date, decimal Amount, string Title, string Meta);

public sealed record NextDrawView(DateOnly Date, bool CoveredByGains, decimal MissingAmount, decimal RemainderAfterPayment);

public sealed record PrizeInfoView(DateOnly DrawDate, string JackpotAmount, string SecondaryPrizes, DateTimeOffset UpdatedAt);
