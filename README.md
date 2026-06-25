# Budget Circulaire

MVP d'une app de budget circulaire pour Windows, iOS et Android via PWA installable.

## Groupe Loto Max

Une premiere version de l'app Loto Max est dans `loto-max`, avec un serveur .NET dans `LotoMaxServer`.

Fonctions deja branchees:

- Soldes de tous les participants visibles par tout le groupe.
- Detail au clic par participant: solde, nombre de tirages couverts, historique date.
- Saisie admin pour depot, gain de groupe et correction.
- Historique global.
- Donnees sauvegardees dans `data/loto-max-state.json`.
- Deduction automatique prevue les mardis et vendredis a minuit.
- Si `Nos gains` couvre le tirage, le systeme paie avec les gains au lieu de retirer 6$ a chaque participant.

PIN admin temporaire:

```text
2468
```

Lancer sur le PC:

```text
Double-cliquer: Lancer Loto Max.cmd
```

Puis ouvrir:

```text
http://localhost:5174/loto-max/
```

La racine fonctionne aussi:

```text
http://localhost:5174/
```

Pour un lien iPhone simple sans Tailscale:

```text
Double-cliquer: Lancer Loto Max avec Tunnel.cmd
```

Cloudflare affichera une URL `https://...trycloudflare.com`. Ouvrir cette URL sur le telephone. La racine ouvre maintenant l'app directement.

## Publication web permanente

Objectif: que les participants puissent consulter les soldes sans que le PC de Pascal reste allume.

Le projet contient maintenant:

- `Dockerfile`: image de production pour hebergement cloud.
- `render.yaml`: configuration Render avec disque persistant.
- `/api/health`: endpoint de verification pour l'hebergeur.
- `LOTOMAX_DATA_PATH`: chemin du fichier de donnees en production.
- `LOTOMAX_ADMIN_PIN`: PIN admin a mettre comme variable secrete, pas dans le code.

Publication recommandee:

1. Envoyer le projet sur GitHub.
2. Creer un Web Service Render depuis le repo.
3. Render detecte `render.yaml`.
4. Configurer la variable secrete `LOTOMAX_ADMIN_PIN`.
5. Attacher le disque persistant `/var/data`.
6. Ouvrir l'URL Render publique, puis partager le lien lecture seule aux participants.

Exemple d'URL courte avec le nom de service Render:

```text
https://loto-equipe-b.onrender.com
```

Important: sans disque persistant ou base de donnees, les soldes pourraient disparaitre lors d'un redeploiement. Le fichier de donnees cloud doit rester dans `/var/data/loto-max-state.json`.

## Fonctions

- Vue annuelle circulaire avec tous les jours de l'annee.
- Pins pour paiements, abonnements, revenus et dettes.
- Repetitions: une fois, chaque semaine, aux 2 semaines, chaque mois, chaque annee.
- Resume des entrees, sorties et solde du mois selectionne.
- Donnees sauvegardees localement dans le navigateur.
- Manifest et service worker pour installation PWA.

## Lancer localement

Avec PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

Puis ouvrir:

```text
http://localhost:5173
```

Pour voir sur un telephone connecte au meme Wi-Fi/reseau local, ouvrir l'adresse locale affichee par le serveur, par exemple:

```text
http://192.168.2.48:5173
```

Si Windows Firewall demande une permission, autoriser l'acces sur les reseaux prives.

Le fichier `index.html` peut aussi etre ouvert directement, mais l'installation PWA et le mode hors-ligne demandent un serveur HTTP local ou un hebergement HTTPS.

## Prochaine etape native

Pour publier dans les stores, on pourra soit garder cette base et l'emballer avec Capacitor, soit migrer l'interface vers Flutter quand le SDK Flutter sera installe.
