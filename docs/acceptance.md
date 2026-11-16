# Acceptance checklist

This is for Mike and the people helping him. Run it on the **test board**
(`Matrix test`), never on the real board. Run the whole list in **Chrome**, then
again in **Safari**. It takes about an hour.

The people:

- **Person A** is whoever is running the list (Mike, or his collaborator).
- **Person B** is a second person, signed in to Trello on their own computer,
  who can edit the test board.
- **The observer** is a third person, signed in to Trello, who can only view
  the test board (they cannot edit it).

Words used here:

- **Parameter**: a dropdown field with two or three levels, such as Value.
- **Level**: one choice in a dropdown field, such as High.
- **Section**: one of the rectangles the matrix is divided into.
- **Across** and **Up**: the two parameters the matrix is laid out by. They are
  chosen in the bar at the top of the matrix.

How to fill it in: do each numbered line, look for what it says you must see,
and write **Pass**, **Fail** or **Not tried** in the Result column, with a few
words if anything looked odd. Make one table for Chrome and one for Safari.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 1 | Person A opens the board and presses **Matrix** (it may be under the "…" menu if the top bar has no room). Press **Connect to Trello** and allow access in the small window. | The matrix opens. After you connect, you are not asked again. If the board has fewer than two parameters, the **Parameters** window opens by itself: leave it open for the next line. | |
| 2 | Add three parameters in the **Parameters** window (press **Parameters…** at the top if it is not open), one at a time, in this order. **Value**: leave the levels as Low, Medium, High, and the better end as High. **Cost**: leave the levels as Low, Medium, High, and choose Low as the better end. **Ease**: choose 2 levels, rename the two levels to Hard and Easy, and choose Easy as the better end. Press **Add parameter** after each, then **Done**. | Three dropdown fields called Value, Cost and Ease appear in Trello's Custom Fields for the board, and in the Parameters window. If Trello will not create them, the window says so: create the three dropdown fields in Trello's Custom Fields instead, then type the same name in the window and press **Link**. | |
| 3 | Press **Lists…** and tick two or three lists that have cards. Set **Across** to **Cost** and **Up** to **Value**. (After line 2 they start as Across Value and Up Cost, so both need changing. **Swap axes** does this in one press.) | Cost runs along the bottom from High on the left to Low on the right, and Value runs up the left side from Low at the bottom to High at the top. The green **Do first** badge is in the top right corner. Every card is in the **Not placed yet** area, because no card has a level yet. | |
| 4 | Drag a card from **Not placed yet** onto the matrix. Then open that card in Trello (close the matrix first, or use a second window). | The card sits where you dropped it. In Trello, its Value and Cost fields show the levels for that spot, and Ease is empty. | |
| 5 | Open the matrix and drag the same card to a new spot inside the same section. Look at the card in Trello. Then reload the browser page and open the matrix again. | The card's fields in Trello do not change. After the reload the card is in the same spot. | |
| 6 | Place two more cards as in line 4, at different heights. Then change **Across** to **Ease**. Then change **Across** back to **Cost**. | With Ease across, the placed cards line up in the strip at the left edge, each at its Value height, because they have no Ease yet. After changing back to Cost, every card is exactly where it was before. | |
| 7 | Leave the matrix open in one window. In a second window (or Person B's computer), open the same board in Trello, open a placed card and change its Value to another level. | Within about 5 seconds, with no reload, the matrix redraws that card in the section for its new Value level. | |
| 8 | In Trello, open **Custom Fields** from the board menu and rename one level (for example High to Top). Then look at the matrix, and open **Parameters…** in it. | The matrix shows the new level name (close and open the matrix if it does not, and note that in Result). In the Parameters window the names are read-only, with the note "Rename parameters and levels in Trello's Custom Fields editor. The matrix shows the new names." | |
| 9 | Zoom in on one card with the mouse wheel (or two fingers on a trackpad) until it is a full card, then zoom back out with **Whole matrix**. Use a card that has a cover image. Then untick **Show images**, and tick it again. | The zoom is smooth. The cover image shows on the full card. Unticking **Show images** hides the images and ticking it shows them again. | |
| 10 | Click a card on the matrix. Then, in Trello, open a card that is on the matrix and press **Show on matrix**. | Clicking the card opens the real Trello card, and Trello closes the matrix. **Show on matrix** opens the matrix zoomed in on that card. | |
| 11 | Use **Colour by** to choose, one at a time: Label, List, Member, and one of the dropdown fields (for example Ease). | Each choice recolours the cards, and the key at the bottom of the matrix names the colours. | |
| 12 | Person B opens the matrix on their own computer and moves a card to another section. Person A watches the matrix and does not reload. | Person A sees the card move within about 5 seconds. | |
| 13 | Press **Resequence lists…** and read the preview. Press **Reorder in Trello**. Look at the lists in Trello. Then open **Resequence lists…** again and press **Undo last reorder**. | The cards in the Trello lists are in the order the preview showed. After **Undo last reorder** they are back as they were. | |
| 14 | The observer opens the matrix (they will be asked to **Connect to Trello** the first time) and tries to drag a card. | The matrix shows the cards. The **Parameters…** and **Resequence lists…** buttons are not there, and the card does not move. Clicking a card still opens it. | |
| 15 | Person A sets **Colour by**, the lists and the zoom to something distinctive, waits a few seconds, then closes the matrix and opens it again. | It opens as it was left: the same lists, the same **Across** and **Up**, the same colouring and the same zoom. | |

## What to send back

1. The filled-in table, one for Chrome and one for Safari.
2. Anything odd, even if it did not stop you: a slow moment, a wrong colour, a
   message you did not understand. A screenshot helps.

## After it passes

The Power-Up is switched on for the real board (`67-Pass-Play-Teamwork`) only
after this checklist passes in both browsers. Mike does that himself. Nobody
else switches it on.
