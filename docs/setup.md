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

   Do not switch on any other capability. If `attachment-thumbnail` (or any
   other) was switched on, switch it off again.
6. Still in the Power-Up, open the **OAuth 2.0** tab. Set it up like this:
   - Set the **security type** to **Public**. (A Public client has no secret.
     That is what this site needs, because it has no server to keep a secret
     on.)
   - Add a **callback URL**, exactly, with nothing before or after it:
     `https://firework-labs.github.io/trello-matrix/oauth-callback.html`
   - Make sure the scopes `read:board:trello` and `write:board:trello` are
     ticked.
   - Press **Save**.
7. Copy the **Client ID** shown on that tab. You will paste it into GitHub in
   Part 3. The Client ID is public by design, so pasting it there is fine.
   - There is **no secret to copy** for a Public client. If the page shows a
     secret anyway, do **not** copy it anywhere: not into GitHub, not into a
     message to us.
8. If the tab or a field is named differently from these steps (Trello may move
   things), send the agent a screenshot instead of guessing.

## Part 3: Tell GitHub the Client ID (you)

1. In the repository go to **Settings**, then **Secrets and variables**, then
   **Actions**, then the **Variables** tab (not "Secrets").
2. Press **New repository variable** and add:
   - Name `TRELLO_CLIENT_ID`, value: the Client ID from Part 2, step 7.
   - Name `PROOF`, value: `1`
     (This adds a "Matrix checks" button to the board, next to the **Matrix**
     button. It is for the first test only. When the checks are finished,
     change the value to `0` (do not delete it) and publish again to remove
     it. With any other value the checks page is not published at all.)
3. Publish the site again, so it picks up the two values. The site was already
   published once, automatically, when the code was first put on GitHub. That
   copy was made before the values existed, so it has no Client ID in it.
   - Simplest: tell the agent the two variables are set. It re-runs the
     publish and checks the result.
   - Or do it yourself: open the **Actions** tab. In the list on the left,
     click **Publish to GitHub Pages**. On the right, above the list of runs,
     press **Run workflow**, then the green **Run workflow** button. Wait for
     a green tick next to the new run (about a minute).

## Part 4: A test board (you)

Do the checks on a copy, never on the real board.

1. Open the Teamwork board. Open the menu, then **More**, then
   **Copy board**. Name the copy `Matrix test`. Choose the Firework Labs
   workspace.
2. On `Matrix test`, open **Power-Ups** and add **Custom Fields**.
3. Still in **Power-Ups**, choose **Custom**, find **Matrix**, and add it.
4. Check that the board now shows a **Matrix** button (under the "…" menu if
   the top bar has no room). Open any card: it now has a **Show on matrix**
   button.
   - The first time a person opens the matrix, it asks them to **Connect to
     Trello**. They do this once. Trello then asks them to allow access in a
     small window.
   - While the variable `PROOF` is `1`, the board also shows a **Matrix
     checks** button. When the checks are finished, set `PROOF` to `0` (Part 3,
     step 2) and publish the site again, as in Part 3, step 3. The **Matrix
     checks** button then goes away.
5. Make sure at least one card on the test board has a **cover image** or an
   **image attachment**. (Open a card, then **Cover**, then pick or upload a
   picture; or use **Attachment** to add an image file.) The image check needs
   one.

## Part 5: Run the checks

1. The first round of checks is in `docs/proof-script.md`. It needs a second
   person logged in to Trello, about ten minutes, in Chrome and then in Safari.
   Send both results back.
2. The checklist for the finished matrix is `docs/acceptance.md`. Run it on the
   test board, in Chrome and in Safari, with a second person.

About signing in: each person allows access once, in a small Trello (or
Atlassian) window. Trello may ask again after 90 days without use. Each person
needs a Trello account that is linked to an Atlassian account.

## If something goes wrong

- **No Matrix button on the board**: look under the "…" menu first. Then check
  the connector URL in Part 2 step 3 has no typing mistake, and that Pages
  shows the site as published. A **Matrix checks** button shows only while the
  variable `PROOF` is `1`.
- **Page not found at the connector URL**: Part 1 step 5 was missed, or the
  publish has not finished. Check the Actions tab.
- **"Matrix checks" opens but the page says it was built without a Trello
  client ID**: the `TRELLO_CLIENT_ID` variable is missing or has a typing
  mistake. After fixing it, re-run the publish.
- **The Matrix page opens but "Connect to Trello" fails or the sign-in window
  does not open properly**: the `TRELLO_CLIENT_ID` variable may be missing or
  have a typing mistake. (Only the **Matrix checks** page says so in words; the
  Matrix page just fails at this step.) Check the variable in Part 3, then
  re-run the publish.
- **The sign-in window shows an error about the redirect or callback
  address**: the callback URL in Part 2 step 6 does not match exactly. Check
  for a missing `https://`, a stray space, or a missing `oauth-callback.html`
  at the end. Save, then try again.
- **The sign-in window stays open with a message that sign-in could not be
  finished**: close it and try again. If it keeps happening, send the agent a
  screenshot of the window.
