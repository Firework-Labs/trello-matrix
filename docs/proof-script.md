# The live check: what to do

This is a short test of what Trello allows. It needs **two people**, each
signed in to Trello with their own account, both members of the `Matrix test`
board. Plan about ten minutes for each browser.

Call the two people **A** and **B**. They can be you and a second person, or
you with a second Trello account in another window. Use the **test board**
only.

Use **one browser tab** for each round and do not close it until you have
copied the results. The page remembers the results in that tab, so reloading
the page or pressing **Matrix checks** again does not lose them.

You do the whole thing twice: first in **Chrome**, then in **Safari**. Press
**Copy results** at the end of each round.

## Before you start

1. Both people open the `Matrix test` board in the same browser.
2. Both press the **Matrix checks** button at the top of the board. A page with
   a table of checks opens.
3. Both tick **This is a test board**. Until you tick it, the checks that change
   the board stay switched off.

## Round: do these in order

1. **Person A: press Run on P1.** Wait for the result. It should say `pass`.
   - If it says `fail`, stop. Copy the results (step 13) and send them back
     now. Do not carry on.
   - The checks that talk to Trello over the web (P5 to P8) need P3 first.
     If one says "Not signed in. Run P3 first.", do step 2 and then run it
     again.
2. **Person A: press Run on P3.** A Trello or Atlassian window asks you to
   allow access. Press **Allow**. After you allow, the small window closes by
   itself. (If it stays open, leave it and tell us.) Then the page asks
   Trello a first question, which takes a moment. The row should say `pass`
   and name the Trello address or addresses that worked. If it says `fail`,
   that is a useful answer too: carry on.
3. **Person A: reload the page** (the browser's reload button, or Cmd+R).
   After a moment, P3 shows a result that adds whether you are still signed in.
   It should say `pass`. Your earlier results stay in the table.
   - If a window asks you to allow access again, that is itself the answer;
     allow it and carry on.
4. **Person A: press Run on P5.** It needs a card with a cover image. If the
   row says `manual` and asks for a cover, add one and run it again.
5. **Person A: press Run on P6.** It moves one card around and sends 30 quick
   requests. It takes a few seconds. Then look at the board: the first card in
   the first list should be back where it was.
6. **Person A: press Run on P7.** It makes a temporary field called `mxproof`
   and deletes it again. If the row says the field could not be deleted, delete
   it by hand on the board (Power-Ups, then Custom Fields).
7. **Person A: press Run on P8.** It writes a short test value on the first
   card, reads the board back through Trello's web service to see whether that
   value comes back, then saves to the card 30 times in a row and removes the
   test value. It takes a few seconds. The row says `pass` or `fail`, and
   the detail line says how long the 30 saves took.
8. **Person A: press Run on P2** and leave the page open. It waits up to 90
   seconds. Do not reload it.
9. **Person B: press Write ping** (next to P2) within those 90 seconds, in
   B's own window. Wait for A's row to change. It tells you whether the page
   noticed without a reload, and how long it took.
10. **Person A: press Run on P4.** A card opens on top of the matrix page.
11. **Person A: close the card** and look at the page again. A moment later, the
    P4 row says either `matrix stayed open` or `matrix was closed`. If it says
    nothing, click inside the page once.
    - If the matrix was closed, press **Matrix checks** again in the same
      tab. The page then reports it, and the earlier results are still there.
12. Look at the **Results** table. Every row should have an answer. Write down
    anything odd you saw on screen (windows that popped up, things that
    flickered).
13. **Press Copy results.** The page copies the answers. A box with the same
    text also appears; if the copy does not seem to work, select all the text
    in the box and copy it by hand.
14. Paste it into a message and send it. Say which browser it came from.

## The second browser

1. Do the whole round again in **Safari**, with **A** and **B** both in Safari.
2. Press **Copy results** and send that too.

## What to send back

**Both pastes**: one from Chrome, one from Safari, plus anything odd you
noticed. The results do not contain any password or token. They do say which
Trello address worked, and any error Trello gave.

## After the checks

Tell the agent you have finished. When it says so, delete the `PROOF`
variable in the repository (Settings, Secrets and variables, Actions,
Variables), then re-run the latest publish in the Actions tab. The "Matrix
checks" button then disappears from the board.
