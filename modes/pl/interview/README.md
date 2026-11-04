# Skille do rozmów rekrutacyjnych

Zestaw skilli wielokrotnego użytku do kompleksowego przygotowania do rozmów rekrutacyjnych.

## Skille

| Skill | Plik | Kiedy używać |
|---|---|---|
| Planer przygotowania | `plan.md` | Na podstawie JD i daty rozmowy zbuduj uporządkowany plan przygotowań podzielony na bloki czasowe |
| Rekruter do ćwiczeń | `practice.md` | Przećwicz pytania rekrutacyjne z uporządkowaną informacją zwrotną |
| Debrief po rozmowie | `debrief.md` | Po prawdziwej rozmowie zamknij luki i zaktualizuj bank pytań |

## Powiązane skille (w nadrzędnym katalogu `modes/`)

| Skill | Plik | Kiedy używać |
|---|---|---|
| Research o firmie | `../../interview-prep.md` | Zbadaj konkretną firmę i rolę przed rozmową |

## Konwencje plików

Te skille zakładają, że istnieją następujące pliki (domyślne w career-ops):

| Plik | Przeznaczenie |
|---|---|
| `users/{USER}/cv.md` | CV kandydata — źródło prawdy o doświadczeniu i dowodach osiągnięć |
| `users/{USER}/article-digest.md` | Zwięzłe dowody osiągnięć z portfolio (opcjonalnie) |
| `users/{USER}/config/profile.yml` | Profil kandydata — docelowe role, wynagrodzenie, narracja |
| `users/{USER}/modes/_profile.md` | Archetypy kandydata, narracja i deal-breakery |
| `users/{USER}/interview-prep/story-bank.md` | Zgromadzone historie STAR+R |
| `users/{USER}/interview-prep/question-bank.md` | Bank pytań ze śledzeniem luk (tworzony przy pierwszym użyciu) |
| `users/{USER}/interview-prep/interview-prep-guide.md` | Ogólne zasady prowadzenia rozmów rekrutacyjnych (opcjonalnie) |
| `users/{USER}/interview-prep/{company}-{role}.md` | Plik przygotowań do konkretnej roli |
| `users/{USER}/interview-prep/sessions/*.md` | Zapisy poszczególnych rund; opcjonalne pole `stated_priorities` we front matter (priorytety roli wskazane przez rozmówcę) zapisywane przez debrief, odczytywane przez plan i practice |
| `users/{USER}/interview-prep/retracted-claims.md` | Twierdzenia, które kandydat odrzucił jako nie do obrony — twarda blokada w practice i debrief (format: `**"[claim]"** ([context]). Reason: [one-line reason + correct framing if applicable].`) |
