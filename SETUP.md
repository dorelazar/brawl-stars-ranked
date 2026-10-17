# Setup: get Brawl Draft on your iPhone (about 20 minutes)

Everything is built. These steps need you because they involve creating accounts.
After this, the app updates itself every 4 hours and your PC can stay off.

You'll do 4 things:

1. Put the project on GitHub (free hosting + the automatic update job)
2. Get a free Brawl Stars API key (the match data)
3. Connect the two and run the first update
4. Add the app to your iPhone home screen

---

## 1. Put the project on GitHub

1. Go to **https://github.com/signup** and create a free account (skip if you have one).
2. Create a new repository: **https://github.com/new**
   - Repository name: `brawl-stars`
   - Visibility: **Public** (free GitHub Pages hosting needs a public repo; nothing private is in it, and your API key stays secret)
   - Don't add a README, .gitignore or license (the project has them)
   - Click **Create repository**
3. On your PC, open a terminal in the project folder and push the code. Replace `YOUR-USERNAME` with your GitHub username:

   ```bash
   cd ~/Desktop/brawl-stars
   ```

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/brawl-stars.git
   ```

   ```bash
   git push -u origin main
   ```

   A browser window opens the first time to sign in to GitHub. Approve it.

4. Turn on hosting: in the repo, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.

   The push already started a first run in the **Actions** tab. It may fail at the deploy step
   because Pages wasn't on yet. That's expected; step 3 runs it again.

## 2. Get a Brawl Stars API key

1. Go to **https://developer.brawlstars.com** and click **Register** (free, Supercell's official developer site).
2. After logging in, open your name (top right) → **My Account** → **Create New Key**.
3. Fill in:
   - **Key Name**: `brawl-draft`
   - **Description**: `Ranked draft helper`
   - **Allowed IP addresses**: `45.79.218.79`

   That IP belongs to the free RoyaleAPI proxy. GitHub's servers change IP all the time,
   so the update job goes through this proxy, which has a fixed address.
4. Click **Create Key**, open the key, and copy the long **Token**.

## 3. Connect them and run the first update

1. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `BS_API_KEY`
   - Secret: paste the token from step 2
   - Click **Add secret**
2. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
3. Click **Daily update** on the left → **Run workflow** → **Run workflow**.
4. Wait about 5–15 minutes until it shows a green check.
   - The run summary shows the app's address, like `https://YOUR-USERNAME.github.io/brawl-stars/`.

From now on it runs by itself every 4 hours.
The first day's data is a decent start; it gets better as it builds up to 14 days.

## 4. Add it to your iPhone

1. On your iPhone, open **Safari** (it must be Safari) and go to `https://YOUR-USERNAME.github.io/brawl-stars/`
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Open it from the home screen. The top bar should show a **green dot** with the number of ranked games.
   A **yellow dot** means live stats aren't connected yet (check step 3).

---

## If something goes wrong

| What you see | What to do |
|---|---|
| Action fails with **"API key rejected (403 …)"** | The key's allowed IP must be exactly `45.79.218.79`. Create a new key with that IP and update the `BS_API_KEY` secret. |
| Action fails at **deploy** with a Pages error | Settings → Pages → Source must be **GitHub Actions**. Then re-run. |
| App shows **yellow dot** after a green run | Open Actions → the run → "Collect ranked battles" step. If it says `BS_API_KEY is not set`, the secret name is misspelled. |
| Status shows **red dot / "may be failing"** | The update job hasn't succeeded for over a day. Check the Actions tab for the error. GitHub also emails you when a scheduled run fails. |
| GitHub stopped running the update job | GitHub pauses schedules in repos with no activity for 60 days. Actions → Daily update → **Enable workflow**. |
