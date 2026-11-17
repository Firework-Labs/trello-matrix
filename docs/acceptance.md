# Acceptance checklist

This is for Mike and the people helping him. Run it on the **test board**
(`Matrix test`), never on the real board.

It is split into rounds. **Round 1** needs one person, one Chrome window and
about 25 minutes. The other rounds need a second window, other people or
Safari, and can be run later, on any day, in any order.

Within a round, do **Setup** first. After that the checks can be done in any
order and spread over several sittings. Each check says what it needs to start
from. If you stop half way, the next sitting starts with Setup line 1 (open the
matrix) and carries on.

Words used here:

- **Parameter**: a dropdown field with two or three levels, such as Value.
- **Level**: one choice in a dropdown field, such as High.
- **Section**: one of the rectangles the matrix is divided into.
- **Across** and **Up**: the two parameters the matrix is laid out by. They are
  chosen in the bar at the top of the matrix.
- **Placed card**: a card that sits on the matrix, not under **Not placed yet**.

How to fill it in: do the line, look for what it says you must see, and write
**Pass**, **Fail** or **Not tried** in the Result column, with a few words if
anything looked odd.

## Round 1: on your own, in Chrome

### Setup

Do these once. If the board was set up in an earlier try, each line says what
to skip.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 1 | Open the board and press **Matrix** (it may be under the "…" menu if the top bar has no room). Do not press **Matrix checks**. If asked, press **Connect to Trello** and allow access in the small window. | The matrix opens. After you connect, you are not asked again. If the board has fewer than two parameters, the **Parameters** window opens by itself: leave it open for line 2. | √ |
| 2 | Press **Parameters…** at the top if the window is not open. If it already lists Value, Cost and Ease, press **Done** and go to line 3. Otherwise add the missing ones, one at a time. **Value**: type the name, leave the levels as Low, Medium, High, and leave the better end as High. **Cost**: type the name, leave the levels as Low, Medium, High, and choose **Low** as the better end. **Ease**: type the name, choose **2 levels**, change Level 1 to Hard and Level 2 to Easy, and choose **Easy** as the better end. Press **Add parameter** after each one, then press **Done**. If the window offers **Link** for a name instead, a field with that name already exists: press **Link** and note that in Result. | Value, Cost and Ease appear as rows in the Parameters window and as dropdown fields in Trello's Custom Fields for the board. If Trello will not create them, the window says so: create the three dropdown fields in Trello's Custom Fields instead, then type the same name in the window and press **Link**. | Using this interface created the parameter (Value), but I had to reload the page for it to be available to link. |
| 3 | If the **Lists** button reads "Lists (0)…", press it and tick two or three lists that have cards. Then set **Across** to Value and **Up** to Cost, and press **Swap axes**. | Until a list is ticked the matrix says "Choose the lists to plot." After the swap, **Across** reads Cost and **Up** reads Value. Cost runs along the bottom from High on the left, through Medium, to Low on the right. Value runs up the left side with Low at the bottom and High at the top. The green **Do first** badge is in the top right corner. Cards with no levels yet are under **Not placed yet**. | √ |

### Checks

Start each one with the matrix open, set up as above (Across Cost, Up Value).

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 4 | **Place a card.** Drag a card from **Not placed yet** onto the matrix. Close the matrix with Trello's close button at the top of the matrix window, then open that card in Trello. | The card sat where you dropped it. In Trello, the card's Value and Cost fields show the levels for that spot, and its Ease field is empty. | √ |
| 5 | **Move within a section.** Press **Matrix** and drag a placed card to a new spot inside the same section. Close the matrix and look at the card in Trello. Then reload the browser page and press **Matrix** again. | The card's Value and Cost in Trello have not changed. After the reload the card is in the spot where you left it, not where it was before. | √ |
| 6 | **Move to another section.** Drag a placed card to a section in a different row and a different column. Close the matrix and open the card in Trello. | Its Value and Cost both show the levels of the new section. | √ |
| 7 | **Change an axis.** Make sure at least three cards are placed, at different heights (drag more from **Not placed yet** if needed). Change **Across** to **Ease**. Then change **Across** back to **Cost**. | With Ease across, cards that have no Ease level line up in the strip at the left edge, each at its Value height. After changing back to Cost, every card is exactly where it was before. | √ |
| 8 | **Zoom and images.** Put a cover image on a placed card in Trello if none has one. Zoom in on that card with the mouse wheel (or two fingers on a trackpad) until it is a full card. While still zoomed in, untick **Show images**, then tick it again. Then press **Whole matrix**. | The zoom is smooth. The cover image shows on the full card. Unticking **Show images** hides the image and ticking it shows it again. **Whole matrix** returns to the whole matrix, with the cards as small dots. | √ |
| 9 | **Open a card and come back.** Click a placed card on the matrix. Then, on the real card that opens, press **Show on matrix**. | Clicking the card opens the real Trello card, and Trello closes the matrix. **Show on matrix** opens the matrix zoomed in on that card. | √ |
| 10 | **Colour.** Use **Colour by** to choose, one at a time: Label, List, Member, and Value. | Each choice recolours the cards, and the key under the matrix names the colours. For Value the key names the levels and "None" for cards with no Value level, which show grey. Fields made by the matrix have no colours of their own, so Value may show every card in grey: that is expected, and it is worth noting. If the board has another dropdown field whose options have colours in Trello, choose that one too. | √ |
| 11 | **Reorder and undo.** Press **Whole matrix**, then **Resequence lists…**, and read the preview. If it says "The lists are already in this order.", press **Cancel**, drag a card to a different section, and try again. Press **Reorder in Trello**. Look at the lists in Trello. Then press **Resequence lists…** again and press **Undo last reorder**. | The cards in the Trello lists are in the order the preview showed. After **Undo last reorder** they are back as they were. | √ |
| 12 | **Rename in Trello.** Close the matrix. In Trello, open the board menu, choose **Custom Fields**, and rename one level of Value (for example High to Top). Open the matrix again and press **Parameters…**. | The matrix shows the new level name. In the Parameters window the names are read-only, with the note "Rename parameters and levels in Trello's Custom Fields editor. The matrix shows the new names." You can rename the level back afterwards. | √ |
| 13 | **Remembers your view.** Set **Colour by**, the lists and the zoom to something distinctive, wait five seconds, then close the matrix and press **Matrix** again. | It opens as it was left: the same lists, the same **Across** and **Up**, the same colouring and the same zoom. | √ |
| 14 | **After an hour.** Do this whenever it happens: come back to the board more than an hour after you last pressed **Connect to Trello**, open the matrix if it is closed, and drag a card to another section. | The card moves and its fields change as before. Or, if a bar "Trello sign-in has expired." appears at the top, press **Connect to Trello** in it and try the drag again, and write down that the bar appeared. | √ |

## Later rounds

These need more than one window, more than one person, or Safari. Run them
when there is time, in any order, on the board as Round 1 left it.

### Round 2: you, with two windows

Open the board in two Chrome windows side by side, with the matrix open in
the first.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 15 | In the second window, open a placed card in Trello (not the matrix) and change its Value to another level. Watch the first window. | Within about 5 seconds, with no reload, the matrix redraws that card in the section for its new Value level. | √ |
| 16 | In the second window, press **Matrix** and drag a placed card to the opposite corner. Watch the first window. | The first window shows the card in its new place within about 5 seconds. | I have over 100 cards in the batch. Not sure if that matters, but I find I have to zoom in or out to get the positioning to refresh in the other browser |

### Round 3: with other people

- **Person B** is a second person, signed in to Trello on their own computer,
  who can edit the test board.
- **The observer** is a third person, signed in to Trello, who can only view
  the test board (they cannot edit it).

Do not press **Reorder in Trello** or **Undo last reorder** on two computers at
the same time. The last one wins, and an undo may then put back only some of
the cards.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| 17 | You press **Whole matrix**, pick a placed card near the bottom left, and tell Person B its title. Person B opens the board, presses **Matrix** and **Connect to Trello**, ticks the same lists as you, and sets **Across** to Cost and **Up** to Value. B drags that card to the top right corner. You watch your matrix and do not reload. | B sees the same cards as you. You see the card leave the bottom left and appear in the top right within about 5 seconds. | The update takes about 1 minute, not 5 seconds. |
| 18 | The observer opens the board, presses **Matrix** and **Connect to Trello**, ticks the same lists as you, and sets **Across** to Cost and **Up** to Value. They try to drag a card, and then click a card. If a message such as "Couldn't save your view" appears, write it down; it does not make this line a fail, but we want to know. | The matrix shows the cards. The **Parameters…** and **Resequence lists…** buttons are not there. The dragged card does not move, and nothing changes in Trello. Clicking a card opens the real card. | Observers cannot add power ups to the boards they're observing. |
| 19 | You press **Resequence lists…** on a board with many cards, and then **Reorder in Trello**. While it runs, Person B has the matrix open and tries to pan, zoom and drag a card. | B's matrix stays usable while your reorder runs. Write down if it stutters or freezes. | √ |

### Round 4: Safari

Run as the same person as Round 1. You may be asked to **Connect to Trello**
again, because each browser connects for itself.

| No. | What to do | What you must see | Result |
|-----|------------|-------------------|--------|
| S1 | Open the board and press **Matrix**. Press **Connect to Trello** if you are asked. | The matrix opens with the lists, **Across**, **Up**, colouring and zoom you last left in Chrome, and the placed cards where they were. | √ |
| S2 | Press **Whole matrix**. Write down the Value and Cost levels of one placed card. Drag it to a section in a different row and a different column. Close the matrix and open that card in Trello. | Its Value and Cost fields both show the levels of the new section. | √ |
| S3 | Press **Matrix** again and drag the same card back to the section it came from. Close the matrix and open the card in Trello. | Its Value and Cost fields are back to the levels you wrote down. | √ |
| S4 | Press **Matrix** and zoom in on a card that has a cover image until it is a full card. Then press **Whole matrix**. | The cover image shows on the full card. **Whole matrix** returns to the whole matrix. | √ |
| S5 | Click a placed card. Then, on the real card that opens, press **Show on matrix**. | Clicking the card opens the real Trello card, and Trello closes the matrix. **Show on matrix** opens the matrix zoomed in on that card. | √ |
| S6 | Do check 11 (reorder and undo). | As in check 11. | I don't actually care about this feature. I did get a message to the effect of: Trello stopped responding on 22 of 102. Resume? |
| S7 | Zoom in a little, wait five seconds, close the matrix and press **Matrix** again. | It opens where it was left: the same lists, **Across** and **Up**, and the same zoom. | √ |

## What to send back

1. The filled-in table for each round you ran. Rounds not yet run can stay
   blank.
2. Anything odd, even if it did not stop you: a slow moment, a wrong colour, a
   message you did not understand. A screenshot helps.

## After it passes

The Power-Up is switched on for the real board (`67-Pass-Play-Teamwork`) only
after all four rounds pass and the three steps below are done. Mike does that
himself. Nobody else switches it on.

Do these steps in this order. They come before anything is switched on for the
real board, because the **Matrix checks** page writes to whichever board it is
opened on.

1. In the repository, go to **Settings**, then **Secrets and variables**, then
   **Actions**, then the **Variables** tab. Change the variable `PROOF` to `0`
   (do not delete it).
2. Open the **Actions** tab, click **Publish to GitHub Pages**, press **Run
   workflow**, and wait for the green tick.
3. Open the test board. Check that the **Matrix checks** button is gone (look
   under the "…" menu too). If it is still there, do not go on: tell the agent.

## Numbering before 2026-11-16

Earlier notes refer to the old single list. Old line 1 to 3 are setup 1 to 3;
4 is 4; 5 is 5; 6 is 7; 7 is 15; 8 is 12; 9 is 8; 10 is 9; 11 is 10; 12 is
17; 13 is 11; 14 is 18; 15 is 13; 16 is 14; 17 is 19. Safari S1 to S7 keep
their numbers. Check 6 and Round 2 line 16 are new.
