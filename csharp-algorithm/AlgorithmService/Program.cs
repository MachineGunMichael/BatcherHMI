using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// POST /apply-settings : Node sends new settings here (idempotent on change_id)
app.MapPost("/apply-settings", async (HttpRequest req) =>
{
    var body = await req.ReadFromJsonAsync<ApplySettingsPayload>();
    if (body is null) return Results.BadRequest();

    // TODO: Apply settings to your DLL here (use body.change_id for idempotency)
    Console.WriteLine($"Apply settings change_id={body.change_id}, version={body.version}");

    return Results.Ok(new { ok = true });
});

app.Run();

public record ApplySettingsPayload(string change_id, int version, object old, object @new, string updated_by, string timestamp);