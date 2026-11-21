// Putokaz na početnoj: šest faza od Skupštine do cele vlasti. Isti tekst kao na slikama za mreže (brend/roadmap.html, roadmap-ig.html).
const FAZE: [string, string, string[]][] = [
  ['Danas', 'Skupština, reč po reč', ['Svaki govor i svako glasanje', 'Prenos uživo sa transkriptom', 'Sažetak dana i AI asistent iz zapisnika']],
  ['Sledeće', 'Poslanik pod lupom', ['Kako je ko glasao, kroz sve sednice', 'Koliko govori i o čemu', 'Pretraga svega što je izgovoreno']],
  ['Zatim', 'Zakon od predloga do primene', ['Put svakog zakona kroz odbore', 'Amandmani i ko ih je podneo', 'Šta se menja, običnim jezikom']],
  ['Zatim', 'Vlada i ministarstva', ['Sednice vlade, uredbe i odluke', 'Budžet i javne nabavke', 'Najavljeno naspram urađenog']],
  ['Zatim', 'Cela vlast na jednom mestu', ['Lokalne skupštine i gradovi', 'Nezavisne institucije i regulatori', 'Otvoreni podaci za novinare i istraživače']],
  ['Cilj', 'Čuvar demokratije', ['Nedeljni pregled: šta je vlast uradila', 'Upozorenje kad se procedura zaobiđe', 'Javna arhiva koja se ne briše']],
]

export function Putokaz() {
  return (
    <section className="ld-sec ld-put" id="putokaz">
      <div className="ld-put-kicker">Putokaz</div>
      <h2>
        Od Skupštine <span>do cele vlasti.</span>
      </h2>
      <p className="ld-put-lead">
        Vlast radi javno, ali niko nema vremena da sve to isprati. <b>Mi pratimo umesto vas</b>: svaku reč, svaki glas i svaku odluku pretvaramo u nešto što se čita za pet
        minuta, sa izvorom uz svaku tvrdnju.
      </p>
      <ol className="ld-put-faze">
        {FAZE.map(([kad, naslov, stavke], i) => (
          <li key={naslov} className={i === 0 ? 'sad' : i === FAZE.length - 1 ? 'cilj' : ''}>
            <div className="ld-put-st">
              <b>0{i + 1}</b>
              {kad}
              {i === 0 && <em>u toku</em>}
            </div>
            <h3>{naslov}</h3>
            <ul>
              {stavke.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className="ld-put-dno">
        <span>Samo iz javnih zapisa</span>
        <span>Svaka tvrdnja ima izvor</span>
        <span>Bez mišljenja, bez strana</span>
      </p>
    </section>
  )
}
