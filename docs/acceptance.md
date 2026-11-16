# Acceptance checklist

This is for Mike and the people helping him. Run it on the **test board**
(`Matrix test`), never on the real board. It takes about an hour.

Run the full list (lines 1 to 15) once, in **Chrome**. It sets the board up, so
it cannot be run a second time on the same board. Then run the short **Second
browser (Safari)** list, which is written for the board as the Chrome run left
it. The matrix remembers each person's lists, axes and zoom in Trello, not in
the browser, so Safari opens where Chrome left off.

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
words if anything looked odd. Fill in one table for Chrome and one for Safari.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 1 | Person A opens the board and presses **Matrix** (it may be under the "…" menu if the top bar has no room). Do not press **Matrix checks**. Press **Connect to Trello** and allow access in the small window. | The matrix opens. After you connect, you are not asked again. If the board has fewer than two parameters, the **Parameters** window opens by itself: leave it open for the next line. | |
| 2 | Add three parameters in the **Parameters** window (press **Parameters…** at the top if it is not open), one at a time, in this order. **Value**: type the name, leave the levels as Low, Medium, High, and leave the better end as High. **Cost**: type the name, leave the levels as Low, Medium, High, and choose **Low** as the better end. **Ease**: type the name, choose **2 levels**, change Level 1 to Hard and Level 2 to Easy, and choose **Easy** as the better end. Press **Add parameter** after each one, then press **Done**. | Three dropdown fields called Value, Cost and Ease appear in Trello's Custom Fields for the board, and as rows in the Parameters window. If Trello will not create them, the window says so: create the three dropdown fields in Trello's Custom Fields instead, then type the same name in the window and press **Link**. If the window offers **Link** for a name because a field with that name already exists, press it and note that in Result. | |
| 3 | Press the **Lists** button (it reads "Lists (0)…") and tick two or three lists that have cards. Then press **Swap axes**. (After line 2 the matrix starts with Across Value and Up Cost; **Swap axes** turns that round.) | Until a list is ticked the matrix says "Choose the lists to plot." Afterwards: **Across** reads Cost and **Up** reads Value. Cost runs along the bottom from High on the left, through Medium, to Low on the right. Value runs up the left side with Low at the bottom and High at the top. The green **Do first** badge is in the top right corner. Every card is under **Not placed yet**, because no card has a level yet. | |
| 4 | Drag a card from **Not placed yet** onto the matrix. Close the matrix with Trello's close button at the top of the matrix window, then open that card in Trello. | The card sat where you dropped it. In Trello, the card's Value and Cost fields show the levels for that spot, and its Ease field is empty. | |
| 5 | Press **Matrix** again and drag the same card to a new spot inside the same section. Close the matrix and look at the card in Trello. Then reload the browser page and press **Matrix** again. | The card's Value and Cost in Trello are the same as at the end of line 4. After the reload the card is in the spot where you left it, not where it was before. | |
| 6 | Drag two more cards onto the matrix at different heights. Then change **Across** to **Ease**. Then change **Across** back to **Cost**. | With Ease across, the placed cards line up in the strip at the left edge, each at its Value height, because they have no Ease yet. After changing back to Cost, every card is exactly where it was before. | |
| 7 | Leave the matrix open in one window. In a second window (or on Person B's computer), open the same board in Trello, open a placed card and change its Value to another level. | Within about 5 seconds, with no reload, the matrix redraws that card in the section for its new Value level. | |
| 8 | In a second window, open the board menu in Trello, choose **Custom Fields**, and rename one level of Value (for example High to Top). Then look at the matrix in the first window, and press **Parameters…** in it. | The matrix shows the new level name (if it does not, close and open the matrix, and note in Result that this was needed). In the Parameters window the names are read-only, with the note "Rename parameters and levels in Trello's Custom Fields editor. The matrix shows the new names." | |
| 9 | Zoom in on one card with the mouse wheel (or two fingers on a trackpad) until it is a full card. Use a card that has a cover image (put one on a placed card in Trello first if none has). While you are still zoomed in on it, untick **Show images**, then tick it again. Then press **Whole matrix**. | The zoom is smooth. The cover image shows on the full card. Unticking **Show images** hides the image and ticking it shows it again. **Whole matrix** then returns to the view of the whole matrix, with the cards as small dots. | |
| 10 | Click a placed card on the matrix. Then, on the real card that opens, press **Show on matrix**. | Clicking the card opens the real Trello card, and Trello closes the matrix. **Show on matrix** opens the matrix zoomed in on that card. | |
| 11 | Use **Colour by** to choose, one at a time: Label, List, Member, and Value (a dropdown field). | Each choice recolours the cards, and the key under the matrix names the colours. For Value the key names the levels (Low, Medium, High) and "None" for cards with no Value level, which show grey. Fields made by the matrix have no colours of their own, so Value may show every card in grey: that is expected, and it is worth noting. If the board has another dropdown field whose options have colours in Trello, choose that one too. | |
| 12 | Person A presses **Whole matrix**, picks a placed card near the bottom left corner of the matrix, and tells Person B its title. Person B opens the board, presses **Matrix** and presses **Connect to Trello** (allowing access). B presses the **Lists** button and ticks the same lists as Person A, then presses **Swap axes** so that Across is Cost and Up is Value, as on Person A's screen. B finds that card and drags it to the opposite corner, the top right. Person A watches the matrix and does not reload. | B sees the same cards as A. Person A sees that card leave the bottom left and appear in the top right within about 5 seconds. | |
| 13 | Person A presses **Resequence lists…** and reads the preview. If it says "The lists are already in this order.", close it with **Cancel**, move a card to a different section as in line 12, and try again. Press **Reorder in Trello**. Look at the lists in Trello. Then press **Resequence lists…** again and press **Undo last reorder**. | The cards in the Trello lists are in the order the preview showed. After **Undo last reorder** they are back as they were. | |
| 14 | The observer opens the board, presses **Matrix** and presses **Connect to Trello** (allowing access). They press the **Lists** button, tick the same lists as Person A, and press **Swap axes**. They try to drag a card, and then click a card. If a message such as "Couldn't save your view" appears, write it down; it does not make this line a fail, but we want to know. | The matrix shows the cards. The **Parameters…** and **Resequence lists…** buttons are not there. The dragged card does not move, and nothing changes in Trello. Clicking a card opens the real card. | |
| 15 | Person A sets **Colour by**, the lists and the zoom to something distinctive, waits five seconds, then closes the matrix and presses **Matrix** again. | It opens as it was left: the same lists, the same **Across** and **Up**, the same colouring and the same zoom. | |

## Second browser (Safari)

Run this after the full list, in Safari, on the same board and as the same
person as in the Chrome run. The board is already set up: the parameters exist,
cards are placed, and the lists, axes and zoom were saved when Chrome closed.
You may be asked to **Connect to Trello** again, because each browser connects
for itself.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| S1 | Open the board and press **Matrix**. Press **Connect to Trello** if you are asked. | The matrix opens with the same lists ticked, **Across** Cost and **Up** Value, the same colouring and zoom, and the placed cards where they were, as at the end of line 15 of the Chrome run. | |
| S2 | Press **Whole matrix**. Write down the Value and Cost levels of one placed card (open it in Trello, or read the axis labels where it sits). Drag that card to a section in a different row and a different column. Close the matrix with Trello's close button and open that card in Trello. | The card's Value and Cost fields in Trello both show the levels of the section you moved it to, and both differ from what you wrote down. | |
| S3 | Press **Matrix** again and drag the same card back to the section it came from. Close the matrix and open the card in Trello. | The card's Value and Cost fields are back to the levels you wrote down. | |
| S4 | Press **Matrix** and zoom in with the mouse wheel (or two fingers on a trackpad) on a card that has a cover image, until it is a full card. Then press **Whole matrix**. | The cover image shows on the full card. **Whole matrix** returns to the view of the whole matrix. | |
| S5 | Click a placed card. Then, on the real card that opens, press **Show on matrix**. | Clicking the card opens the real Trello card, and Trello closes the matrix. **Show on matrix** opens the matrix zoomed in on that card. | |
| S6 | Press **Whole matrix**, then **Resequence lists…**, and read the preview. If it says "The lists are already in this order.", press **Cancel**, drag a card to a different section, and try again. Press **Reorder in Trello**. Look at the lists in Trello. Then press **Resequence lists…** again and press **Undo last reorder**. | The cards in the Trello lists are in the order the preview showed. After **Undo last reorder** they are back as they were. | |
| S7 | Zoom in a little on the matrix, wait five seconds, then close the matrix and press **Matrix** again. | It opens where it was left: the same lists, **Across** and **Up**, and the same zoom. | |

## What to send back

1. Both filled-in tables: the full list (run in Chrome) and the Second browser (Safari) list.
2. Anything odd, even if it did not stop you: a slow moment, a wrong colour, a
   message you did not understand. A screenshot helps.

## After it passes

The Power-Up is switched on for the real board (`67-Pass-Play-Teamwork`) only
after this checklist passes in both browsers. Mike does that himself. Nobody
else switches it on.
