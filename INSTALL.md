# Installation Guide

There are two ways to use Canvas Schedule Planner:

1. **Use the hosted version** — no installation needed, best for trying it out or beta testing
2. **Self-host your own instance** — clone the repo and deploy to your own GitHub Pages

## Option 1: Use the hosted version

**URL**: [https://quinnsnell.github.io/CanvasSchedulePlugin/](https://quinnsnell.github.io/CanvasSchedulePlugin/)

No installation required. Open the link, configure your course, and start planning. Your schedule data stays in your browser's local storage — nothing is sent to any server except Canvas itself.

### Setup steps

1. Open the URL above in your browser (Chrome, Firefox, Safari, or Edge)
2. Click the **gear icon** (⚙) in the top right to open Course Setup
3. Fill in your course title, semester start/end dates, and which days you teach
4. Under **Canvas connection**, enter:
   - **Canvas base URL**: your institution's Canvas address (e.g., `https://canvas.youruniversity.edu`)
   - **Personal Access Token**: generate one in Canvas under Account → Settings → "+ New Access Token"
5. Click **Connect** — you should see your courses appear in a dropdown
6. Select your course and click **Refresh** to import all assignments

That's it. Your schedule auto-saves in your browser. Return to the same URL to pick up where you left off.

### Embedding in Canvas

Once you've built your schedule, you'll want to set up two Canvas Pages — one for you to edit the schedule, and one for students to view it.

#### 1. Create the editor page (for you)

This page embeds the planner so you can edit your schedule directly inside Canvas.

1. In your Canvas course, go to **Pages** → **+ Page**
2. Name it **Schedule-Editor** (or whatever you prefer)
3. Switch to the **HTML editor** (click `</>` in the toolbar)
4. Paste:
   ```html
   <p>Use the schedule planner below to manage your course schedule. Changes save automatically in your browser.</p>
   <iframe src="https://quinnsnell.github.io/CanvasSchedulePlugin/" style="width: 100%; height: 900px; border: none;"></iframe>
   ```
5. Click **Save**
6. **Do NOT publish this page** — it's for your use only, not for students

#### 2. Publish the student schedule

1. Open your Schedule-Editor page and use the planner to build your schedule
2. Click the **publish button** (↑) in the planner toolbar
3. This creates (or updates) a Canvas Page called **Schedule** with a clean, read-only view of your schedule
4. The Schedule page is automatically published and visible to students

#### 3. Add both pages to a module

To keep things organized, create a module for your schedule pages:

1. Go to **Modules** in your Canvas course
2. Click **+ Module** and name it **Content** (or any name you like)
3. Click the **+** button on the module to add items:
   - Add the **Schedule** page (published — students see this)
   - Add the **Schedule-Editor** page (unpublished — only you see this)
4. The Schedule-Editor page won't appear to students since it's unpublished, but it gives you quick access from the Modules page

#### 4. Keeping the schedule updated

Whenever you make changes in the planner:
1. Open your Schedule-Editor page (or the hosted URL directly)
2. Make your changes — they save automatically in your browser
3. Click **publish** (↑) again to update the student-facing Schedule page

Students always see the last-published version. You can edit freely without affecting what students see until you publish.

### About the CORS proxy

The hosted version uses a shared CORS proxy (`canvas-cors-proxy.qsnell.workers.dev`) to forward requests to Canvas, since Canvas blocks direct cross-origin browser requests. This proxy:

- Is a stateless pass-through — it adds CORS headers and forwards your request to Canvas
- Does not store any data, tokens, or credentials
- Is open source (see `cors-proxy/worker.js` in this repo)

Your Canvas Personal Access Token is sent through the proxy in the request header. If you prefer not to route through a shared proxy, see Option 2 to deploy your own.

## Option 2: Self-host your own instance

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- A GitHub account (for GitHub Pages hosting)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier, for the CORS proxy)

### Step 1: Fork or clone the repo

```bash
# Fork via GitHub UI, then clone your fork:
git clone https://github.com/YOUR-USERNAME/CanvasSchedulePlugin.git
cd CanvasSchedulePlugin
npm install
```

### Step 2: Deploy the CORS proxy

The CORS proxy is a small Cloudflare Worker (~50 lines) that forwards Canvas API requests with proper CORS headers.

```bash
# Install Wrangler (Cloudflare's CLI) if you don't have it
npm install -g wrangler

# Authenticate with Cloudflare
wrangler login

# Deploy the proxy worker
cd cors-proxy
wrangler deploy
```

Wrangler will output your proxy URL, something like:
```
https://canvas-cors-proxy.YOUR-SUBDOMAIN.workers.dev
```

Save this URL — you'll enter it in the app's setup panel under "CORS proxy URL".

### Step 3: Enable GitHub Pages

1. Go to your fork's **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. The included `deploy.yml` workflow will automatically build and deploy on every push to `main`

Your app will be available at:
```
https://YOUR-USERNAME.github.io/CanvasSchedulePlugin/
```

### Step 4: Configure the app

1. Open your GitHub Pages URL
2. Click the **gear icon** (⚙) to open Course Setup
3. Enter your Canvas base URL and Personal Access Token
4. Under **CORS proxy URL**, enter your Cloudflare Worker URL from Step 2
5. Click **Connect**, select your course, and click **Refresh**

### Local development

To run the app locally with Canvas API proxying through Vite's dev server:

```bash
# Edit dev.sh to set your Canvas URL, then:
./dev.sh
```

Or manually:

```bash
VITE_CANVAS_URL=https://canvas.youruniversity.edu npm run dev
```

Open http://localhost:5173. In dev mode, Vite proxies Canvas API requests directly — no CORS proxy needed.

### Running tests

```bash
npm test
```

## Sharing the student schedule

After setting up your schedule, you can publish it as a Canvas Page:

1. Click the **publish button** (↑) in the toolbar
2. The schedule is uploaded to your Canvas course as a Page called "Schedule"
3. Copy the link and share it with students, or embed it in your Canvas course

The published schedule is a static HTML page that responds to the student's dark/light mode preference. Students don't need the planner app — they just view the Canvas Page.

## Troubleshooting

### "Could not connect" error
- Double-check your Canvas base URL (include `https://`, no trailing slash)
- Make sure your Personal Access Token is valid and not expired
- If you see a CORS error in the browser console, the CORS proxy may be unreachable — try entering the proxy URL manually in the setup panel

### Assignments not appearing after refresh
- Make sure you selected the correct course from the dropdown
- Only published and unpublished assignments are imported — deleted assignments won't appear
- Check that your token has permission to access the course (you must be an instructor/TA)

### Data loss concerns
- Your schedule is saved in your browser's local storage, tied to the course ID
- Clearing browser data will remove your schedule — use **Publish** to back up to Canvas
- Use **Export template** in the setup panel to save a portable copy of your schedule

### Pop-up blocked when creating assignments
- The "+ Assignment" button opens Canvas in a new tab — allow pop-ups for the app's domain
- After saving the assignment in Canvas, return to the planner tab — it will auto-import the new assignment
