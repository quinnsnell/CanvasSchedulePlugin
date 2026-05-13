# Optional: Auto-resizing the planner iframe in Canvas

By default, Canvas iframes use the fixed `height` you set in the page
HTML. The planner ships with a tall default (5000px), which works for
most semesters but leaves blank space on shorter ones and may require
tuning per-course.

**True auto-resize requires a parent-side script.** Canvas strips
`<script>` tags from individual Page HTML on save, so this can't be
done at the page level — the script has to live in the institution's
**Theme Editor** (Admin → Themes → Upload custom JavaScript) and
applies to every page in the account.

The planner already posts its content height to its parent on every
size change (`{type: 'planner-resize', height: <px>}`). All your
Canvas admin needs to do is add a matching listener.

## What your admin needs to install

```js
// Auto-resize iframes that post {type:'planner-resize', height:N}.
// Drop into Admin → Themes → Edit → Upload custom JavaScript.
window.addEventListener('message', function (e) {
  var d = e && e.data;
  if (!d || d.type !== 'planner-resize' || typeof d.height !== 'number') return;
  // Bound the height so a buggy/malicious sender can't make a 0px iframe
  // or a 100000px one that breaks the page.
  var h = Math.max(200, Math.min(20000, d.height));
  var frames = document.querySelectorAll('iframe');
  for (var i = 0; i < frames.length; i++) {
    if (frames[i].contentWindow === e.source) {
      frames[i].style.height = h + 'px';
      frames[i].setAttribute('height', String(h));
      break;
    }
  }
});
```

That's the whole listener — no library, no build, no maintenance.
It identifies the right iframe by comparing `contentWindow === e.source`,
so it only ever resizes the iframe that actually sent the message.

## After installation

You can drop the giant fixed height from the iframe HTML, or leave a
small placeholder (e.g. `height: 600px`) so the iframe has a sensible
initial render before the first resize message arrives (~100ms after load).

```html
<iframe src="https://your-host/"
        scrolling="no"
        style="width:100%; height:600px; border:0; overflow:hidden"></iframe>
```

The iframe will then track its actual content height — no blank space,
no nested scrolling.

## If you can't install the script

That's the common case. Stick with the fixed-height embed described
in [INSTALL.md](../INSTALL.md). The planner-side `postMessage` keeps
running harmlessly; if your Canvas instance later gains the listener,
auto-resize lights up automatically with no code change on your end.
