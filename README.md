# Josh Fantasy League

A single-page fantasy hockey league site for a 12-team league: standings, an 8-week schedule, a snake draft board with real player stats, roster management (5 skaters, 1 goalie, 2 bench, 1 IR), free agents, accounts, and a commissioner settings panel.

Everything lives in one file, `index.html`, with no build step.

## Run it

Open `index.html` in a browser, or serve the folder:

    python3 -m http.server 8000

## Host it free with GitHub Pages

1. Push this repo to GitHub.
2. In the repo go to Settings, then Pages.
3. Under Build and deployment, pick "Deploy from a branch", branch `main`, folder `/ (root)`, and save.
4. Your site appears at `https://<your-username>.github.io/<repo-name>/`.

## Scoring

- Skaters: 3 per goal, 2 per assist, 0.25 per shot on goal, 0.02 per touch.
- Goalies: +2 per win, +1 per save, -3 per goal against, +3 per shutout.

Shots on goal, touches, wins and shutouts are not in the imported stats yet. Add them in the `XS` (skaters), `W` and `SO` (goalies) objects near the top of the script.

## Important: accounts, admin and settings

The shared features (account login, team assignment, kicking members, league settings) were built on Claude's artifact database, which only exists when the page is hosted by Claude. On GitHub Pages those features are switched off and the Account tab will say it needs the league database. Draft picks and roster moves are saved in each visitor's own browser.

To get shared accounts and settings on GitHub Pages you would need a backend such as Supabase or Firebase.

The admin password check is also client-side only, so treat it as a convenience, not security.

## Editing league data

Teams, logos, players and the schedule generator are all in the `<script>` block of `index.html`.
