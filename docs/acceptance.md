# Acceptance checklist

This is for Mike and the person helping him. Run it on the **test board**
(`Matrix test`), never on the real board. Run the whole list in **Chrome**, then
again in **Safari**. It takes about an hour. You need a second person who is
signed in to Trello and can edit the test board (called "person B" below), and
a third who can only view it (called "the observer").

Words used here:

- **Parameter**: a dropdown field with two or three levels, such as Value.
- **Level**: one choice in a dropdown field, such as High.
- **Section**: one of the rectangles the matrix is divided into.

How to fill it in: do each numbered line, look for what it says you must see,
and write **Pass**, **Fail** or **Not tried** in the Result column, with a few
words if anything looked odd. Do one table for Chrome and one for Safari.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 1 | Open **Matrix** from the board (under the "…" menu if the top bar has no room). Press **Connect to Trello** and allow access in the small window. Then choose the lists to show. | The matrix opens. After connecting once, the cards of the chosen lists appear, or a hint tells you to add parameters. Closing and opening the matrix does not ask you to connect again. | |
| 2 | Add three parameters: **Value** (better end High), **Cost** (better end Low) and **Ease** (two levels, better end Easy). | Three dropdown fields called Value, Cost and Ease appear on the board in Trello's Custom Fields. If Trello will not create them, the dialog says so. In that case create the three dropdown fields in Trello, then link each one in the dialog. | |
| 3 | Drag a card from **Not placed yet** onto the matrix. Then open that card in Trello. | The card sits where you dropped it. In Trello, its Value and Cost fields show the levels for that spot. | |
| 4 | Move a card to a new spot inside the same section. Look at the card in Trello. Then reload the page. | The card's fields in Trello do not change. After the reload the card is in the same spot. | |
| 5 | Change **Across** to **Ease**. Then change it back to Cost. | With Ease across, cards line up in the left strip, at their Value heights. After changing back, no card has moved. | |
| 6 | In Trello, change the Value of one card by hand (open the card and choose another level). | The matrix redraws that card in the section for its new level, without a reload. | |
| 7 | In Trello's Custom Fields editor, rename one level (for example High to Top). | The matrix shows the new name. The name cannot be changed from the matrix: the parameters dialog shows names as read-only and says to use Trello's Custom Fields editor. | |
| 8 | Zoom from the whole matrix in to one full card, then back out. Use a card that has a cover image. Press **Show images**. | The zoom is smooth. The cover image shows on the card. **Show images** hides the images and shows them again. | |
| 9 | Click a card. Then, on a card, press **Show on matrix**. | Clicking opens the real card, and Trello closes the matrix. **Show on matrix** opens the matrix zoomed in to that card. | |
| 10 | Use **Colour by** in turn: label, a dropdown field, list and member. | Each choice recolours the cards, and the legend underneath names the colours. | |
| 11 | Person B opens the matrix on their own computer and moves a card. Person A watches, without reloading. | Person A sees the card move within about 5 seconds. | |
| 12 | Press **Resequence lists…**. Read the preview. Press **Reorder in Trello**. Look at the lists in Trello. Then press **Undo last reorder**. | The Trello lists are in the order the preview showed. After **Undo last reorder** they are back as they were. | |
| 13 | The observer (who cannot edit the board) opens the matrix. | The matrix shows the cards, and the observer cannot move them. | |
| 14 | Close the matrix and open it again. | It opens where it was left: the same lists, axes, colouring and zoom. | |

## What to send back

1. The filled-in table, one for Chrome and one for Safari.
2. Anything odd, even if it did not stop you: a slow moment, a wrong colour, a
   message you did not understand. A screenshot helps.

## After it passes

The Power-Up is switched on for the real board (`67-Pass-Play-Teamwork`) only
after this checklist passes in both browsers. Mike does that himself. Nobody
else switches it on.
