# Kako da pomogneš

Hvala što hoćeš da pomogneš. Ovaj repo je samo frontend; sve što ti treba za rad je u njemu.

## Pre nego što počneš

- Za veću izmenu prvo otvori issue i opiši ideju, da ne radiš nešto što neće moći da se prihvati.
- Male ispravke (greška u prikazu, pristupačnost, telefon, brzina) mogu odmah kao pull request.

## Tok rada

```bash
# fork na GitHub-u, pa:
git clone https://github.com/<tvoj-nalog>/skupstina-live.git
cd skupstina-live && npm install
git switch -c kratak-opis
npm run dev          # proveri u pregledaču, i na širini telefona
npm run check        # lint + build; mora da prođe
git push -u origin kratak-opis   # pa otvori pull request
```

U pull requestu napiši šta se menja iz ugla posetioca i dodaj snimak ekrana ako se menja izgled.

## Pravila

- **Neutralnost.** Sajt prenosi zapisnik; tekst na sajtu ne sme da sadrži mišljenje ni da staje na bilo čiju stranu.
- **Podaci se ne menjaju ručno.** `public/data/` pravi obrada zapisnika. Grešku u podacima prijavi, ne ispravljaj JSON.
- **Bez novih zavisnosti** bez dogovora. Sajt namerno ima samo `react`, `react-dom` i `motion`.
- **Bez novih spoljnih adresa** (skripte, fontovi, praćenje). Sajt ima strog CSP i ne šalje podatke posetilaca trećim stranama.
- **Telefon je prvi.** Većina posetilaca je na telefonu; proveri širinu 375 px.
- **Tekst je na srpskom**, latinicom; komentari u kodu takođe.
- Ne dodaj ključeve, lične podatke ni adrese servera.

## Šta se dešava posle

Sajt se objavljuje iz privatnog repoa. Kad je tvoj pull request prihvaćen, održavalac ga prenosi tamo, izmena izlazi na skupstina.live,
a ovaj repo se usklađuje sa sajtom. Zato tvoj PR može biti zatvoren umesto spojen dugmetom: izmena je ipak ušla, uz tvoje ime u poruci commita.

## Poruke commitova

Kratko, na srpskom, šta se promenilo za posetioca: `Uživo: chat ostaje na dnu kad stigne nova poruka`
