# Setting up the Matrix Power-Up

This is for Mike. The agent cannot do these steps: they need your Trello and
GitHub accounts. It takes about 30 minutes. You only do it once.

Words used here:

- **Repository**: the project's home on GitHub.
- **Pages**: GitHub's free web hosting. It serves the Power-Up to Trello.
- **Power-Up**: a small add-on that Trello loads into a board.

## Part 1: GitHub (you)

1. Sign in to GitHub as a person who can create things under **Firework-Labs**.
2. Create a new repository named `trello-matrix` under Firework-Labs.
   - Make it **Public**. The page contains only code, never card data.
   - Leave "Add a README" and the other tick boxes **off**.
3. Invite the agent machine's GitHub account to the repository, with
   permission to write. (Repository, then Settings, then Collaborators.)
4. Tell the agent the repository now exists. It will add the link and publish
   the code. Wait for that before step 5.
5. Turn on Pages. In the repository go to **Settings**, then **Pages**. Under
   **Build and deployment**, set **Source** to **GitHub Actions**.

## Part 2: Register the Power-Up in Trello (you)

1. Open <https://trello.com/power-ups/admin> and sign in.
2. Press **New** (or **Create new Power-Up**).
3. Fill in the form:
   - **Name**: `Matrix`
   - **Workspace**: Firework Labs
   - **Iframe connector URL**:
     `https://firework-labs.github.io/trello-matrix/index.html`
   - The other boxes (email, support contact, author) can be you.
4. Press **Create**.
5. Open the new Power-Up, then **Capabilities**. Turn on:
   - **Board buttons**
   - **Card buttons**
6. Open **API key**. Press **Generate a new API key**. Trello shows an
   **API key** and a **Secret**.
   - The **API key** is public by design. You can paste it into GitHub.
   - **Never copy the Secret anywhere.** Leave it where it is.
7. Under **Allowed origins** on that same page, add exactly:
   `https://firework-labs.github.io`
   and save.

## Part 3: Tell GitHub the key (you)

1. In the repository go to **Settings**, then **Secrets and variables**, then
   **Actions**, then the **Variables** tab (not "Secrets").
2. Press **New repository variable** and add:
   - Name `TRELLO_APP_KEY`, value: the API key from Part 2, step 6.
   - Name `PROOF`, value: `1`
     (This adds a "Matrix checks" button to the board. It is for the first
     test only. We will remove it later.)
3. Go to the **Actions** tab. If the first publish already ran before you added
   the variables, open it and press **Re-run all jobs**. Wait for a green tick.

## Part 4: A test board (you)

Do the checks on a copy, never on the real board.

1. Open the Teamwork board. Open the menu, then **More**, then
   **Copy board**. Name the copy `Matrix test`. Choose the Firework Labs
   workspace.
2. On `Matrix test`, open **Power-Ups** and add **Custom Fields**.
3. Still in **Power-Ups**, choose **Custom**, find **Matrix**, and add it.
4. Check that the board now shows a **Matrix** button at the top right. If the
   variable `PROOF` is `1`, you also see **Matrix checks**.
   Until the next build stage is deployed, the **Matrix** and **Show on matrix**
   buttons open an empty page; only **Matrix checks** works. That is expected.
5. Make sure at least one card on the test board has a **cover image**. (Open a
   card, then **Cover**, then pick or upload a picture.) The image check needs
   one.

## Part 5: Run the checks

Follow `docs/proof-script.md`. It needs a second person logged in to Trello,
about ten minutes, in Chrome and then in Safari. Send both results back.

## If something goes wrong

- **No Matrix button on the board**: check the connector URL in Part 2 step 3
  has no typing mistake, and that Pages shows the site as published.
- **Page not found at the connector URL**: Part 1 step 5 was missed, or the
  publish has not finished. Check the Actions tab.
- **"Matrix checks" opens but says something about the key**: the
  `TRELLO_APP_KEY` variable is missing or wrong, or the allowed origin in
  Part 2 step 7 is missing. After fixing, re-run the publish.
