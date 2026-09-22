# Cadet Lounge Foosball Leaderboard

A shared, phone-friendly foosball leaderboard connected to your Supabase project.

## 1. Create the database

1. Open your Supabase project.
2. Open **SQL Editor** and choose **New query**.
3. Copy all of `supabase-setup.sql` into the editor and click **Run**.

The script creates `players` and `games`, enables live updates, and applies Row Level Security. Visitors may read standings, add players, and record matches.

## 2. Turn on admin editing

1. Open `supabase-admin-upgrade.sql`, change the PIN in the `insert into admin_settings` line from `2468` to whatever code your admins should use.
2. Paste the whole file into Supabase **SQL Editor** and click **Run** (once, after step 1 above).

This also adds two optional columns (`player_one_score`, `player_two_score`) to `games`, so a final score can be recorded and edited alongside the winner. **Run this script even if you don't care about admin editing** — the site's data query now asks for those columns, so standings won't load until they exist.

This adds a PIN-gated set of database functions that let the site edit or delete matches and players. Visitors still cannot touch the tables directly — every edit/delete goes through a function that checks the PIN inside Postgres first. To change the PIN later, run in SQL Editor:

```sql
update public.admin_settings set pin_hash = crypt('NEW_PIN_HERE', gen_salt('bf'));
```

On the site, click the lock icon next to "Live & synced" and enter the PIN to unlock editing. Edit/delete buttons then appear next to each player in the roster and each match in the log. Click the lock icon again to lock it back up.

## 3. Test locally

Open `index.html` in a browser. If your browser blocks local-file requests, serve the folder with any static web server, for example:

```bash
python3 -m http.server 8080
```

Then visit `http://localhost:8080`.

## 4. Put it online

Upload the contents of this folder to any static host, such as Netlify, Cloudflare Pages, GitHub Pages, or Vercel. No build command or server is required.

For Netlify, you can drag this entire folder into the deployment area at https://app.netlify.com/drop and receive a public URL.

## Scoring and ranking

- Ranked by Elo rating (starts at 1000, K-factor 32) — beating a stronger opponent gains more than beating a weaker one
- Tiebreakers: win percentage, then wins, then player name
- Win/loss/win% and the old 3-points-per-win total still show as reference columns
- Elo, standings, and match history recompute from the full match log on every load, so editing or deleting a past match automatically re-ranks everyone correctly
- Standings and match history update live on every open device
- Recording a match, the final score (e.g. 10–7) is optional — enter both and the winner auto-fills; leave both blank to just log the result without a score

## Correcting a mistake

Unlock admin mode (lock icon, top right) with the shared PIN, then use the ✎ / 🗑 buttons next to a match in the log or a player in the roster. No Supabase dashboard access needed for day-to-day corrections — see "Turn on admin editing" above to set the PIN. If you'd rather edit the database directly, Supabase's **Table Editor** still works too.

## Security note

The publishable key in `app.js` is intended for browser use. Access is limited by the SQL Row Level Security policies. Never place a Supabase secret key or service-role key in these files.
