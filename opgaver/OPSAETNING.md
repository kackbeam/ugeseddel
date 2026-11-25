# Opsætning af Firebase til Opgaver-appen

Det tager ca. 15–20 minutter og skal kun gøres én gang. Gør det helst på en computer.
Brug den Google-konto, som skal "eje" appen (fx firmaets eller din egen).

---

## 1. Opret projektet

1. Gå til **https://console.firebase.google.com** og log ind med Google-kontoen.
2. Tryk **Opret et projekt** (Create a project).
3. Navn: fx `opgaver-firma`. Tryk videre.
4. **Google Analytics:** slå det **fra**, da det ikke skal bruges. Tryk **Opret projekt**.

## 2. Slå login til

1. Vælg **Build → Authentication** i menuen til venstre, og tryk **Kom i gang**.
2. Under **Sign-in method / Login-metode** vælger du **E-mail/adgangskode**.
3. Slå den øverste kontakt **til** (ikke "link via e-mail") og tryk **Gem**.

## 3. Opret databasen

1. Vælg **Build → Firestore Database** og tryk **Opret database**.
2. Placering: vælg **eur3 (Europe)**.
3. Vælg **Start i produktionstilstand** og tryk **Opret**.
4. Gå til fanen **Regler** (Rules). Slet alt, hvad der står der.
5. Åbn filen [`firebase/firestore.rules`](firebase/firestore.rules), kopiér **hele** indholdet og indsæt det.
6. Tryk **Publicer**.

## 4. Slå billeder og filer til (kræver betalingskort)

1. Tryk på **⚙️ → Brug og fakturering** nederst til venstre, og opgrader til planen **Blaze (betal efter forbrug)**. Tilknyt et betalingskort.
2. Sæt en **budgetalarm** når du bliver spurgt, fx **10 kr.** Så får du en mail, hvis det nogensinde begynder at koste noget.
3. Vælg **Build → Storage** og tryk **Kom i gang**.
4. Placering:
   - **`us-central1`**: de første **5 GB er gratis**. Det anbefales, så prisen holdes på 0 kr.
   - **En EU-placering** (fx `europe-west1`): så ligger billederne i EU, men der er ingen gratis kvote. For et lille firma koster det få kroner om måneden.
5. Vælg **produktionstilstand** og tryk **Opret**.
6. Gå til fanen **Regler**, slet alt og indsæt hele indholdet af [`firebase/storage.rules`](firebase/storage.rules). Tryk **Publicer**.
   Hvis der kommer en besked om at give Storage adgang til Firestore, så tryk **Tillad**.

> Appen gør billeder mindre, inden de sendes op (typisk 200–400 KB stykket). Der kan altså ligge omkring 15.000 billeder inden for de gratis 5 GB.

## 5. Tillad at appen bruges fra GitHub-siden

1. Gå til **Authentication → Indstillinger (Settings) → Autoriserede domæner**.
2. Tryk **Tilføj domæne** og skriv: `kackbeam.github.io`

## 6. Hent oplysningerne til appen

1. Tryk på **⚙️ → Projektindstillinger**.
2. Rul ned til **Dine apps** og tryk på web-ikonet **`</>`**.
3. Kaldenavn: `Opgaver`. Sæt **ikke** hak i Firebase Hosting. Tryk **Registrer app**.
4. Du ser nu et stykke kode med `const firebaseConfig = { apiKey: "...", ... }`.
5. Åbn filen `opgaver/firebase-config.js` her i GitHub, og tryk på blyanten for at redigere.
6. Kopiér værdierne over, så filen ser sådan ud (med jeres egne værdier):

```js
export const firebaseConfig = {
  apiKey: 'AIzaSy....',
  authDomain: 'opgaver-firma.firebaseapp.com',
  projectId: 'opgaver-firma',
  storageBucket: 'opgaver-firma.firebasestorage.app',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abc123',
};
```

7. Tryk **Commit changes**.

> Det er helt i orden, at disse oplysninger står offentligt. De er ikke en adgangskode. Sikkerheden ligger i reglerne fra trin 3 og 4. Du kan også bare sende værdierne til Claude, så sætter Claude dem ind.

## 7. Gør dig selv til chef

1. Åbn appen: **https://kackbeam.github.io/ugeseddel/opgaver/**
2. Tryk **"Ny bruger? Opret dig her"** og opret dig med navn, e-mail og adgangskode.
3. Appen siger nu "Venter på godkendelse". Det er forventet.
4. Gå tilbage til Firebase-konsollen: **Firestore Database → Data → users →** dit dokument (med din e-mail).
5. Ret feltet **role** fra `afventer` til `chef` og gem. Appen åbner af sig selv et øjeblik efter.

Dette trin er kun nødvendigt for den første chef. Herefter klares alt i appen.

## 8. Medarbejdere

1. Send linket til folkene: **https://kackbeam.github.io/ugeseddel/opgaver/**
2. De åbner det i **Chrome** på Android og vælger **⋮ → Installér app** (eller "Føj til startskærm").
3. De trykker **"Ny bruger? Opret dig her"**.
4. Du godkender dem i appen under **⋮ → Brugere**. En orange prik viser, når nogen venter.
5. Stopper en medarbejder, så sæt vedkommende til **Deaktiveret** under Brugere.

---

## Opdatering af regler (version 1.1)

Version 1.1 har fået rapport, godkendelse og indstillinger. Derfor skal databasereglerne opdateres:
**Firestore Database → Rules**: slet alt, indsæt hele indholdet af [`firebase/firestore.rules`](firebase/firestore.rules) igen og tryk **Publish**.

## Godt at vide

- **Uden net:** noter, start/stop og afslutning gemmes på telefonen og sendes automatisk, når der er net igen. Det samme gælder billeder, som venter i kø. Billeder og opgaver, man har set før, kan også ses uden net.
- **Glemt adgangskode:** der er et link på login-siden, som sender en mail.
- **Hvem kan hvad:**
  - **Chef:** opretter, retter, sletter og genåbner opgaver, godkender rapporter og brugere og styrer indstillingerne.
  - **Medarbejder:** ser alle opgaver, starter og stopper dem, melder dem færdige med en rapport og tilføjer noter og billeder.
- **Brugervejledninger** (PDF) ligger i [`vejledning/`](vejledning/) og kan åbnes fra appens menu og login-siden.
