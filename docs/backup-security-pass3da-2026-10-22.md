# BerryIT PASS 3D-A — faktisk körningsrapport

## Resultat: BLOCKED — teknisk behörighet på core saknas

**Godkännande A är mottaget och gäller.** Stoppet beror på att befintlig
SSH-åtkomst på core-node-01 inte kan utföra den nödvändiga privilegierade
diskhälsokontrollen. Det är inte en begäran om nytt godkännande A.

Förkontrollen kördes 2026-10-22 cirka 00:04 CEST. Inga installations- eller
konfigurationssteg påbörjades efter den nekade kontrollen, enligt uppdragets
stoppvillkor vid saknad säkerhetsförutsättning.

## 1. Baslinje och kontroll av tidigare utfört A

- Repository `C:\projects\berryit`, branch `feat/support-desk`, HEAD
  `dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`.
- Samtliga 13 befintliga ospårade PASS 3A/3B/3C-filer verifierades med SHA-256
  och är oförändrade. Tracked och staged diff är tomma. Ingen annan aktiv
  BerryIT-chatt syntes i appens trådlista.
- PASS 3C:s rekommendation om Restic + append-only rest-server återanvändes.
  Tidigare godkända återställnings-/regressionstester kördes inte om.
- Restic saknas i PATH på båda servrarna och på den granskade standardplatsen
  `/usr/local/bin/restic`. rest-server saknas motsvarande på core.
- De föreslagna katalogerna `/srv/berryit-backup`, `/var/lib/berryit-backup`,
  `/etc/berryit-backup` saknas på core. De granskade BerryIT-backupkontona och
  units/timers saknas också. Ingen genomförd A-installation kunde därmed
  återfinnas i granskade sökvägar eller BerryIT-relaterade systemd-enheter.
  Detta är ingen fullständig inventering av varje möjlig alternativ sökväg.

## 2. Exakt teknisk blockerare

| Kontroll | core-node-01, `glasso` | prod-node-01, `ubuntu` |
|---|---|---|
| Befintlig strikt SSH | Fungerar | Fungerar |
| `sudo -n -l` | **Exit 1, lösenord krävs** | Exit 0, befintlig lösenordsfri administrativ regel synlig |
| `sudo -n smartctl -j -d sat -H -A /dev/sda` | **Exit 1, åtkomst nekad före hälsobedömning** | Inte relevant/kört |
| SMART-tjänst | Fortsatt **failed** | Inte kontrollerad |
| Tailscale | Running / online | Running / online |

SMART-resultatet är okänt; inget PASSED eller faktiskt diskfel kan påstås.
Att smartmontools finns installerat innebär inte att denna session kan läsa
enheten. Ingen sudo-policy, grupp, identitet eller systeminställning ändrades
för att komma runt spärren. Inga lösenord efterfrågades eller lagrades.

Core har cirka **45,08 GB ledigt** vid kontrollen. PASS 3C:s kapacitetsbedömning
är därmed fortsatt rimlig; ledigt utrymme ersätter inte verifierad diskhälsa.

## 3. Vad som faktiskt installerats, konfigurerats och testats

| Åtgärd inom A | Faktisk status |
|---|---|
| Behörig diskhälsokontroll | **BLOCKED**, kommandot nekades |
| Restic på prod/core | **Inte installerat** |
| rest-server på core | **Inte installerat** |
| Skyddad/kapacitetsbegränsad destination | **Inte skapad eller monterad** |
| Begränsade backup-/tunnelidentiteter | **Inte skapade** |
| Privat backup-SSH och append-only endpoint | **Inte konfigurerade** |
| Append-only DELETE-/overwrite-/scope-/kvottester | **Inte körda** |
| Syntetisk Restic-backup och restore | **Inte körda** |
| Recoverymaterial utanför prod | **Inte genererat eller distribuerat** |
| Automatisering | **Ingen serverunit/timer skapad eller aktiverad**; tidigare plan kvarstår |
| Riktig produktionsbackup, migration eller hotfix | **Inte körda** |

Inget PASS för en installerad eller säker backupväg påstås. PASS 3C:s tidigare
syntetiska PostgreSQL/Storage/konfig-test är separat bevisning och stänger inte
PASS 3D-A:s installations-, behörighets- eller raderingsskyddsgrindar.

## 4. Skydd av befintlig drift

Förkontrollens Docker-metadata jämfördes lokalt med slutbilden från PASS 3C:

- Alla **68** befintliga core-containrar har samma ID, state, starttid och
  restart count. Ingen tillkommande eller försvunnen container hittades.
- Samtliga **26** avsiktligt pausade containrar är fortsatt stoppade med
  faktisk restart-policy `no`.
- FLIQS-appens health är healthy, boten kör. AuroraPark och Allstars visar
  healthy på de befintliga containrar som har healthcheck. Inga nya HTTP-
  end-to-end-kontroller påstås i detta pass.
- Inga filer, konton, mounts, SSH-/Tailscale-inställningar eller tjänster
  konfigurerades på någon server. Inga omstarter, raderingar eller nya containrar.
- Ingen produktionsdata kopierades och inget GPG-kommando kördes på servrarna.

## 5. Nödvändig fortsättning

**A behöver inte godkännas igen.** En behörig operatör behöver antingen
tillhandahålla en fungerande, avsedd administrativ exekveringsväg på core eller
själv utföra de privilegierade momenten där. Ingen credential ska publiceras
i rapporten eller Git.

Fortsätt därefter inom redan godkänt A:

1. Utför och granska den läsande SMART-kontrollen; utred USB-/diskproblem om
   resultat saknas eller visar fel. Ingen avstängning av övervakning som genväg.
2. Verifiera att föregående stopporsak är löst och baslinjen fortfarande gäller.
3. Genomför versionslåst installation, avgränsad destination, begränsade
   identiteter och privat backuptransport enligt PASS 3C:s plan.
4. Verifiera raderingsskydd, scope, kvoter, felhantering och syntetisk restore
   samt recoveryåtkomst utan prod. Förbered automatisering inaktiv.
5. Stoppa efter A-rapporten. Riktig produktionsbackup och senare hotfix/
   migration kräver sina separata godkännanden och utförs inte inom A.

## 6. Lokal leverans och Git

Nytt: denna PASS 3D-A-rapport och `backup-security-pass3da-manifest.json`.
Förkontrollskript och redigerade metadata ligger ignorerade i
`test-results/pass3da`. Inga nya produktfunktioner, historiska migrations-
ändringar, installationer på Windows eller ändringar i andra repositories.

Totalt **15 ospårade granskningsfiler** inklusive de 13 tidigare; tom tracked/
staged diff, oförändrad HEAD. Ingen commit, push eller deployment.

Arbetet stoppades vid den verifierade behörighetsspärren.
