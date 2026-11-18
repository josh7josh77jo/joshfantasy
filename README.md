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

## Accounts, admin and settings (Supabase)

Shared accounts, team assignment, kicking members and league settings use a Supabase project. The project URL and publishable key are in `index.html` (`SUPA_URL`, `SUPA_KEY`). The publishable key is safe to expose; the row-level security rules in `schema.sql` decide who can change what.

Setup:
1. Create a Supabase project. Under Authentication, Providers, Email, turn off "Confirm email".
2. Run `schema.sql` in the SQL Editor.
3. Sign up on the site, then make yourself admin in the SQL Editor:

       update profiles set is_admin = true where username = 'your-username';

Admins see the team assignment table in the Account tab and the Settings tab. Logins use a username plus a hidden email of the form `username@josh-fantasy.app`.

Draft picks and roster moves are still saved in each visitor's own browser, not shared.

## Editing league data

Teams, logos, players and the schedule generator are all in the `<script>` block of `index.html`.
