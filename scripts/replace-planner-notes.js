// Browser-console snippet to rewrite a URL across all rich-text notes
// in the planner's current-course state. Paste into DevTools console
// while the planner tab is open.
//
// Edit OLD and NEW to your values, then paste the whole block. It
// runs in dry-run mode first (logs matches); re-paste with APPLY=true
// to write the change to localStorage and reload the page.

(() => {
  const OLD = 'https://discord.gg/ZT7fbnw9d';
  const NEW = 'https://discord.gg/ajASk4Zty';
  const APPLY = false; // flip to true once the dry-run output looks right

  const key = Object.keys(localStorage).find(
    (k) => k.startsWith('class-planner-v3-')
  );
  if (!key) {
    console.error('No planner state found in localStorage.');
    return;
  }
  const state = JSON.parse(localStorage.getItem(key));

  // Match both discord.gg/CODE and discord.com/invite/CODE variants.
  const codeMatch =
    OLD.match(/discord\.gg\/([^\/?#]+)/i) ||
    OLD.match(/discord\.com\/invite\/([^\/?#]+)/i);
  const code = codeMatch?.[1];
  const re = code
    ? new RegExp(`https?://(?:www\\.)?discord\\.(?:gg/${code}|com/invite/${code})\\b`, 'gi')
    : new RegExp(OLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

  let matches = 0;
  let notes = 0;
  for (const item of Object.values(state.items || {})) {
    if (item.type !== 'rich' || !item.html) continue;
    const m = item.html.match(re);
    if (!m) continue;
    notes += 1;
    matches += m.length;
    console.log(`Note ${item.id}: ${m.length} match(es)`);
    m.forEach((s) => console.log(`    ${s}`));
    if (APPLY) item.html = item.html.replace(re, NEW);
  }
  console.log(
    `\n${matches} match(es) across ${notes} note(s). Mode: ${APPLY ? 'APPLIED' : 'DRY RUN'}`
  );

  if (APPLY && matches > 0) {
    localStorage.setItem(key, JSON.stringify(state));
    console.log('Wrote localStorage. Reload the page, then Publish to update the Schedule Canvas Page.');
  }
})();
