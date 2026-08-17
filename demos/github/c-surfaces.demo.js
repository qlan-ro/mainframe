// GitHub tour, segment C — worktrees, the board, automations, review + inline
// comments, and pairing a remote daemon.
//
// Needs no adapter replay, so nothing here can hit the dropped-send race.
// Beat order matters: Review Changes is a modal that covers the sidebar, so the
// surfaces that live in the sidebar are filmed before it opens.
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/tour-c.webm';
  // 1920 wide: the transcript is a fixed-width centred column, so the floating
  // session panels only clear it once there is real margin to the right.
  const SIZE = { width: 1920, height: 1080 };

  let t0 = 0;
  const marks = [];
  const mark = async (locator, kind, cursorType, note) => {
    const b = await locator.boundingBox().catch(() => null);
    if (!b) return;
    marks.push({ tMs: Date.now() - t0, kind, cursorType, note,
      cx: (b.x + b.width / 2) / SIZE.width, cy: (b.y + b.height / 2) / SIZE.height,
      w: b.width / SIZE.width, h: b.height / SIZE.height });
  };
  const tap = async (locator, cursorType, note, opts) => {
    await mark(locator, 'click', cursorType, note);
    await locator.click(opts ?? {});
  };

  // Chapter cards are off for the shipped cut. Flip CHAPTERS to true to get the
  // full-screen title cards back; the pause keeps the pacing either way.
  const CHAPTERS = false;
  const chapter = (title, opts) =>
    CHAPTERS ? page.screencast.showChapter(title, opts) : page.waitForTimeout(700);


  await page.setViewportSize(SIZE);
  await page.addInitScript((v) => localStorage.setItem('mf:tutorial', v), '{"state":{"completed":true,"step":4},"version":0}');
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /acme-web/ }).first().click();
  await page.waitForTimeout(600);
  await page.getByTestId('sessions-new-button').click();
  await page.getByTestId('chat-composer-input').waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);

  // Warm the board view off camera. The tasks store keeps `view` for the page
  // session, so the on-camera open lands straight on the board — one less click,
  // and no cursor jump across the modal.
  await page.getByTestId('sidebar-action-kanban').click();
  await page.getByTestId('tasks-view-board').click({ force: true });
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  await page.screencast.stop().catch(() => {});
  await page.screencast.start({ path: OUT, size: SIZE });
  t0 = Date.now();

  // ---- Worktrees -----------------------------------------------------------
  await chapter('Isolate the work', {
    description: 'Give a session its own worktree and branch.',
    duration: 1800,
  });
  await tap(page.getByTestId('composer-worktree-trigger'), 'pointer', 'worktree');
  await page.waitForTimeout(2400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // ---- The board -----------------------------------------------------------
  await chapter('Track the work', {
    description: 'A board per project — start a session straight from a card.',
    duration: 1800,
  });
  await tap(page.getByTestId('sidebar-action-kanban'), 'pointer', 'board');
  await page.waitForTimeout(1400);
  await page.waitForTimeout(3200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // ---- Automations ---------------------------------------------------------
  await chapter('Put it on a schedule', {
    description: 'Automations run the agent on a trigger, unattended.',
    duration: 1800,
  });
  // The rail keeps re-laying out while these surfaces mount, so Playwright's
  // stability check never settles; force past the actionability wait.
  await tap(page.getByTestId('sidebar-action-automations'), 'pointer', 'automations', { force: true });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // ---- Remote daemons ------------------------------------------------------
  await chapter('Or run it somewhere else', {
    description: 'Point the app at a daemon on another machine.',
    duration: 1800,
  });
  await tap(page.getByTestId('daemon-footer-trigger'), 'pointer', 'daemon picker');
  await page.waitForTimeout(2000);
  await page.getByTestId('daemon-picker-add').click();
  await page.waitForTimeout(1200);
  const url = page.getByTestId('daemon-add-url');
  if (await url.isVisible().catch(() => false)) {
    await url.click();
    await url.pressSequentially('https://studio.remote:31415', { delay: 55 });
    await page.waitForTimeout(1400);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  // ---- Review + inline comments, last: the modal covers everything ---------
  await chapter('Review before you commit', {
    description: 'Side-by-side diffs, comments on a line, and the commit.',
    duration: 1900,
  });
  await tap(page.getByTestId('surface-rail-workspace'), 'pointer', 'workspace');
  await page.waitForTimeout(1200);
  await tap(page.getByTestId('workspace-picker-view-changes'), 'pointer', 'view changes');
  await page.waitForTimeout(2600);

  // Anchor a comment on a diff line, the way a reviewer would.
  // Two things bite here: CodeMirror splits a line across token spans (so getByText
  // never matches the statement), and only the MODIFIED pane anchors a comment —
  // a click in `.cm-merge-a` is silently ignored.
  await tap(page.locator('.cm-merge-b .cm-line').filter({ hasText: 'reduce' }).first(), 'text', 'anchor a comment');
  await page.waitForTimeout(900);
  const comment = page.getByTestId('review-comment-input');
  await comment.click();
  await comment.pressSequentially('Guard against a negative quantity here.', { delay: 50 });
  await page.waitForTimeout(700);
  await tap(page.getByTestId('review-comment-submit'), 'pointer', 'post the comment');
  await page.waitForTimeout(2600);
  await page.mouse.move(640, 470);
  await page.waitForTimeout(1400);

  await page.screencast.stop();
  return JSON.stringify({ video: OUT, size: SIZE, durationMs: Date.now() - t0, marks });
}
