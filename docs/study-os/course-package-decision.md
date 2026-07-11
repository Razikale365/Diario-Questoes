# Study OS Course Package Decision

Decision date: 2026-07-11

## Decision

Select the current complete theory package **BACEN (Analista - Area 2 - Economia e Financas) - Pacote** as the first production course source for Study OS.

Public catalog URL:

`https://www.estrategiaconcursos.com.br/curso/bacen-analista-area-2-economia-e-financas-pacote/`

Target: `bacen_economia_financas`

Status: `selected`

Acquisition method: `estrategia_downloader`

The package has not yet been recorded as downloaded or validated. Its account package id, downloader version, destination root, completion time, and filesystem PDF count remain pending until a fresh authenticated download finishes.

## Downloader Discovery

The previous Fiscal Brain integration expected an external `Estrategia Downloader Pro` project at `C:\Docker\Cursos Estratégia`. The current directory contains only an empty `Downloads` folder; the downloader source is no longer installed there.

The likely tool lineage is `Coruja Downloader Pro` (publicly described as version 3.1), but its source and dependencies must be reviewed before credentials are entered. Study OS will record the verified downloader version actually used, not assume `3.1` from an old integration or post.

## Why This Package

The public catalog currently exposes the broad BACEN Area 2 course and includes common subjects plus the target-specific core: Microeconomia, Macroeconomia, COSIF, Estatistica e Econometria, and Financas.

The separate BACEN Passo Estrategico package is not the primary course source. Estrategia explicitly warns that some subjects may be absent from that product, while complete packages include all subjects.

The current RFB Auditor complete package remains a valid fallback, but it does not beat BACEN while `bacen_economia_financas` is the selected strategic direction. Existing fiscal study history remains transferable evidence and is not discarded.

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

## Candidate Comparison

| Candidate | Target fit | Completeness | Role in Study OS | Decision |
| --- | --- | --- | --- | --- |
| BACEN Area 2 complete package | Highest for active direction | Complete theory package | Primary advancement source | Selected |
| BACEN Area 2 Passo Estrategico | High | Provider warns some subjects may be absent | Optional comparative/review signal | Not primary |
| RFB Auditor complete package | High fiscal transfer | Complete theory package | Fallback if target changes | Not selected now |
| Existing Fiscal 2023 directory | Historical only | Stale local snapshot | Fixture and regression evidence | Never production |

## Acquisition Gate

1. Restore or install the user's Estrategia Downloader in its dedicated external directory after reviewing its source and dependencies.
2. Record its version and verify authenticated access to the selected package.
3. Resolve the account package id corresponding to the public BACEN complete package.
4. Download all available PDFs into a new stable directory.
5. Count PDFs independently and record download failures.
6. Register that exact root in Study OS M2.

Study OS does not store Estrategia credentials and does not implement a replacement downloader.
