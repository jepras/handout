# Nordpension – Projektkontext

## Om Nordpension

Nordpension er et dansk arbejdsmarkedspensionsselskab med kompleks, distribueret data-arkitektur. Selvom det er opdigtet til denne workshop, afspejler det realistiske enterprise-systemer hvor data ligger spredt over fem separate systemer, ikke ét centraliseret warehouse.

## De 5 Datasystemer

- **medlem** — Medlemssystem (OLTP) med PII: navne, CPR, adresser, bidragsmønstre, pensionsprojektioner
- **crm** — Kundesager, interaktioner, helbredsnoter og operationelle alerts
- **erp** — Back-office: medarbejdere, afdelinger, finansposter
- **dwh** — Data Warehouse med analytiske rapporter, KPI'er, board reports, 15 års historik
- **kms** — Knowledge Management: politikker, processer, FAQ, ordbog, IT-systemer

## Strategisk Fokus: AI & Compliance

Nordpension arbejder med **to veje** til at bringe AI ind:

1. **MCP-connectoren** (Chat/Cowork) — AI med automatisk PII-filtrering, compliant fra dag ét
2. **Direkte Supabase API** (Code) — Fuld adgang til alle data; udvikler har selv ansvar for compliance

## Fokusområder for AI-Initiative

- **Dataforståelse**: Hvad ligger hvor? Hvordan krydser man systemerne?
- **Compliance-ved-designet**: AI kan arbejde frit uden at skulle håndtere PII
- **Prototyping**: Rådgiver-360, datakvalitets-monitors, anomali-detektorer
- **Anomali-analyse**: Bidragsanomalier, SLA-brudte sager, mønstre uden at se helbredsnoter

## Ledelse

**Direktør: Victor**

Victor prioriterer teknologisk modernisering, data-driven beslutninger og sikring af at AI kan bruges ansvarligt uden at kompromittere medlemsdata.
