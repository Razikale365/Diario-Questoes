# Study OS Course Package Decision

Decision date: 2026-07-11

## Decision

Select the currently owned **Receita Federal (Auditor Fiscal) Pacotaco - Pacote Teorico + Pacote Passo Estrategico** as the first production course source for Study OS.

Authenticated package URL:

`https://www.estrategiaconcursos.com.br/app/dashboard/pacote/249654`

Package id: `249654`

Target: `rfb_auditor`

Status: `selected`

Acquisition method: `estrategia_downloader`

The package has not yet been recorded as downloaded or validated. The downloader version, destination root, completion time, and filesystem PDF count remain pending until a fresh authenticated download finishes.

## Downloader Discovery

The previous Fiscal Brain integration expected an external `Estrategia Downloader Pro` project at `C:\Docker\Cursos Estratégia`.

An auditable downloader source is now checked out separately at `C:\Docker\Cursos Estratégia\AutoDownloadEstrategiaConcurso`, upstream commit `2af5b839cbcc48a466bed615931ef11a9f7290b0`. Its reviewed code uses Selenium with manual login and does not request or persist credentials. The upstream script is not ready to run for M2 unchanged: it downloads every visible course including videos, has no package selector, emits no acquisition manifest, and relies on selectors that must be checked against the current site. A local package-scoped PDF-only adapter must be completed and tested before authenticated execution.

## Why This Package

Authenticated inspection on 2026-07-11 confirmed that package `249654` is available in the account and currently contains 50 course entries: 31 regular entries and 19 Passo Estrategico entries. The regular side includes the complete fiscal core plus recent additions for LTC/reforma tributaria dated 2025 and 2026. The course entries are shown as available through 2026-12-31.

This is the best first acquisition on current evidence because it is already owned, current, broad, and combines original course material with the optional Passo comparison source. It also maximizes reuse of the user's existing fiscal preparation without pretending the historical 2023 PDFs are current.

BACEN remains a supported exam target and may still be the better eventual concurso decision. It is not the first production course root because no current BACEN course appeared among the account's non-archived enrollments inspected on 2026-07-11. Selecting this RFB source does not silently select RFB as the only exam: the multi-target planner must label transferable subjects and keep BACEN-specific gaps explicit.

## Fresh Download Rule

No existing course directory is accepted as production merely because its package name still matches.

`C:\Users\JP\Downloads\Pacote Regular Fiscal 2023` is fixture and historical evidence only. The PDFs available on Estrategia have been updated since that download. If the decision later returns to the same Fiscal package line, that package must also be downloaded again through Estrategia Downloader into a fresh directory.

The downloader run must record:

- downloader name and exact version;
- authenticated Estrategia package id and URL;
- start and completion timestamps;
- fresh destination root;
- independent post-download PDF count;
- incomplete/failed item count, if any.

Only then can status advance from `selected` to `downloaded`. Study OS advances it to `validated` only after the scanner count equals the independent filesystem count.

The downloader run also leaves `.study-os-download.json` inside the fresh package root. The manifest repeats the package id, acquisition id, downloader name/version, ordered timestamps, expected count, independently observed count, and failure count. A `downloaded` or `validated` record is rejected when that manifest is missing, outside the root, invalid, or inconsistent with the record. This prevents an old directory from being promoted simply by editing its status.

## Candidate Comparison

| Candidate | Target fit | Completeness | Role in Study OS | Decision |
| --- | --- | --- | --- | --- |
| RFB Auditor package 249654 | Owned; strongest immediate fiscal fit | 31 regular + 19 Passo entries | First production source and transfer baseline | Selected |
| BACEN Area 2 complete package | Highest direct fit if BACEN becomes the exam | Not present in inspected non-archived enrollments | Add as a later source when owned/current | Not first acquisition |
| BACEN Area 2 Passo Estrategico | High direct review fit | May omit subjects and is not primary theory | Optional later comparison source | Not primary |
| Existing Fiscal 2023 directory | Historical only | Stale local snapshot | Fixture and regression evidence | Never production |

## Acquisition Gate

1. Finish the package-scoped PDF-only adapter in the dedicated downloader directory and test its selectors without storing credentials.
2. Record the adapter/upstream versions and verify authenticated access to package `249654`.
3. Start a new acquisition id and create a previously nonexistent stable destination root.
4. Download all available PDFs from package `249654` into that root.
5. Count PDFs independently and record download failures.
6. Register that exact root in Study OS M2.

Study OS does not store Estrategia credentials and does not implement a replacement downloader.
