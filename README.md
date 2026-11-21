# Skupština live — frontend

Nezavisno, nestranačko praćenje sednica Narodne skupštine Srbije: svaki dan kao montažna traka sa snimkom i tekstom reč po reč,
sva glasanja, sala sa svim poslanicima, deljenje citata i prenos uživo sa chatom.

Sajt: **https://skupstina.live** · nije zvanični sajt Narodne skupštine.

Ovo je kod frontenda (React + Vite + TypeScript). Otvoren je da bi svako mogao da pomogne: ispravka greške, bolji prikaz na telefonu,
pristupačnost, brzina, nova ideja za prikaz podataka.

*English: this is the open-source frontend of skupstina.live, an independent tracker of the Serbian National Assembly sessions.
Code comments and docs are in Serbian. Contributions are welcome, see CONTRIBUTING.md.*

## Pokretanje

Potrebno: Node 24 (ili 22.18+) i npm.

```bash
git clone https://github.com/vuklazovic/skupstina-live.git
cd skupstina-live
npm install
npm run dev        # http://localhost:5173
```

Ne treba ti ključ, nalog ni pristup našem serveru:

- **Podaci su u repou.** Svi objavljeni dani, govori, glasanja i poslanici su JSON fajlovi u `public/data/`.
- **Server je zamenjen lokalnim** (`dev/lokalni-api.ts`): chat radi u memoriji tvog računara, kontakt forma ispisuje poruku u terminalu,
  video citata se pravi bez snimka iz sale.
- **Dan uživo** (`/uzivo`) čita javne fajlove sa skupstina.live, iste koje dobija svaki posetilac. Bez mreže: `SKUPSTINA_BEZ_MREZE=1 npm run dev`.
- **AI asistent** (`/staro`) lokalno radi samo sa tvojim OpenRouter ključem, koji ostaje u tvom pregledaču.

Pre pull requesta: `npm run check` (lint + build). Isto radi CI.

## Struktura

| Putanja | Šta je |
|---|---|
| `src/traka/` | glavna verzija (`/`): početna sa glasanjima, sala, dan kao traka, govor reč po reč, deljenje citata |
| `src/live/` | prenos uživo (`/uzivo`): snimak, ko govori, chat, reakcije, igrice |
| `src/App.tsx`, `src/components/`, `src/assistant/` | sala i prethodna verzija (`/staro`); glavna verzija iz nje koristi salu, vesti i kontakt |
| `src/index.css`, `src/dodatak.css`, `src/traka/*.css` | stilovi (bez CSS biblioteke) |
| `public/data/` | podaci koje sajt čita. **Ne menjaj ručno**: pravi ih obrada zapisnika, koja nije deo ovog repoa |
| `public/photos/` | fotografije poslanika |
| `dev/lokalni-api.ts` | lokalna zamena za server, samo u razvoju |

Adrese: `/` početna · `/?dan=s15-01-d3` jedan dan · `/?dan=s15-01-d3&t=3600` dan od određene sekunde · `/uzivo` · `/staro`.

## Čega ovde nema

Server (chat, kontakt, asistent, isečci snimka, admin), obrada podataka (stenogrami, transkripcija, sažeci) i deploy su u privatnom repou.
Ovaj repo se ne objavljuje sam na sajt: prihvaćene izmene održavaoci prenose u produkciju.

Greška u podacima (pogrešan govornik, vreme, sažetak)? Ne ispravljaj JSON: prijavi je preko kontakta na sajtu ili kao issue.

## Licenca i sadržaj

Kod je pod licencom iz fajla [LICENSE](LICENSE). Podaci u `public/data/` potiču iz javnih zapisnika i snimaka Narodne skupštine;
fotografije poslanika su sa zvaničnog sajta Skupštine i nisu obuhvaćene licencom koda. Ime i znak „Skupština live” nisu deo licence.

Kontakt: skupstinalive@gmail.com · bezbednosni propusti: [SECURITY.md](SECURITY.md)
