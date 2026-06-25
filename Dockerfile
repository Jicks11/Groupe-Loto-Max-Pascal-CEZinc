FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY LotoMaxServer/LotoMaxServer.csproj LotoMaxServer/
RUN dotnet restore LotoMaxServer/LotoMaxServer.csproj

COPY LotoMaxServer/ LotoMaxServer/
RUN dotnet restore LotoMaxServer/LotoMaxServer.csproj
RUN dotnet publish LotoMaxServer/LotoMaxServer.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

COPY --from=build /app/publish .
COPY loto-max ./loto-max
COPY loto-649 ./loto-649

ENV LOTOMAX_STATIC_ROOT=/app/loto-max
ENV LOTO649_STATIC_ROOT=/app/loto-649
ENV LOTOMAX_DATA_PATH=/var/data/loto-max-state.json
ENV LOTO649_DATA_PATH=/var/data/loto-649-state.json
ENV TZ=America/Toronto
EXPOSE 8080

ENTRYPOINT ["sh", "-c", "dotnet LotoMaxServer.dll --urls http://0.0.0.0:${PORT:-8080}"]
