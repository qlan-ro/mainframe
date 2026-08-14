// GitHub tour, segment D — quoting the transcript, the session rail, a live
// workflow run, and capturing a task without leaving.
//
// Boot: MF_DEMO_RECORDING_KEY=workflow .agents/demo-env.sh up
//
// The workflow fixture leaves a four-phase run mid-flight, so the Activity panel
// has real work in it and the row drills into the run panel. The conversation is
// sent BEFORE recording starts: segment A already showed a prompt being typed, so
// this segment opens on the payoff.
async page => {
  const APP_URL = 'http://localhost:5183';
  const OUT = '/tmp/mainframe-demo/out/tour-d.webm';
  // 1920 wide: the transcript is a fixed-width centred column, so the floating
  // session panels only clear it once there is real margin to the right.
  const SIZE = { width: 1920, height: 1080 };
  const PROMPT = 'Run the release-readiness workflow';

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

  const CHAPTERS = false;
  const chapter = (title, opts) =>
    CHAPTERS ? page.screencast.showChapter(title, opts) : page.waitForTimeout(700);

  const label = (b, text) => `
    <div style="position:absolute; top:${b.y - 3}px; left:${b.x - 3}px;
      width:${b.width + 6}px; height:${b.height + 6}px;
      border:2px solid #3b82f6; border-radius:8px;"></div>
    <div style="position:absolute; top:${b.y + b.height + 10}px;
      left:${b.x + b.width / 2}px; transform:translateX(-50%);
      padding:6px 12px; background:rgba(0,0,0,.75); border-radius:8px;
      font:13px -apple-system,system-ui; color:#fff; white-space:nowrap;">${text}</div>`;

  await page.setViewportSize(SIZE);
  await page.addInitScript((v) => localStorage.setItem('mf:tutorial', v), '{"state":{"completed":true,"step":4},"version":0}');

  // Off camera: get the workflow running. A dropped send can only be recovered by
  // a full reload — retrying inside one page session abandons the create again.
  let sent = false;
  for (let attempt = 0; attempt < 5 && !sent; attempt++) {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: /acme-web/ }).first().click();
    await page.waitForTimeout(700);
    await page.getByTestId('sessions-new-button').click();
    const composer = page.getByTestId('chat-composer-input');
    await composer.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1100);
    await composer.click();
    await composer.fill(PROMPT);
    await composer.press('Enter');
    sent = await page.getByText(PROMPT, { exact: true }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  }
  if (!sent) throw new Error('dropped send — retake');
  await page.getByText(/Review is running over/).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.screencast.stop().catch(() => {});
  await page.screencast.start({ path: OUT, size: SIZE });
  t0 = Date.now();

  // ---- Quote from the transcript ------------------------------------------
  await chapter('Quote what matters', {
    description: 'Select any part of the transcript and reply to just that.',
    duration: 1800,
  });

  // A real drag, not locator.selectText(): the toolbar arms on mouseup, and a
  // DOM-range selection never fires one, so the quote button never appears.
  const answer = page.getByText(/Review is running over/).last();
  const ab = await answer.boundingBox();
  await page.mouse.move(ab.x + 3, ab.y + 12);
  await page.mouse.down();
  await page.mouse.move(ab.x + ab.width - 3, ab.y + 12, { steps: 24 });
  await page.mouse.up();
  const quoteButton = page.getByTestId('chat-selection-quote');
  await quoteButton.waitFor({ timeout: 10000 });
  const quoteMark = await page.screencast.showOverlay(label(await quoteButton.boundingBox(), 'Quote it into your reply'));
  await page.waitForTimeout(1300);
  await tap(quoteButton, 'pointer', 'quote it');
  await quoteMark.dispose();
  await page.getByTestId('composer-quote-preview').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // ---- The session rail ----------------------------------------------------
  await chapter('The session at a glance', {
    description: 'Summary, activity, launches and tasks — one rail.',
    duration: 1800,
  });
  await tap(page.getByTestId('session-panel-rail-open'), 'pointer', 'session summary');
  await page.waitForTimeout(2200);

  // ---- The live workflow run ----------------------------------------------
  await chapter('Watch a workflow run', {
    description: 'Phases, agents, tokens — while it is still going.',
    duration: 1800,
  });
  await tap(page.getByTestId('session-panel-rail-activity'), 'pointer', 'activity');
  await page.waitForTimeout(1400);

  const runRow = page.locator('[data-testid=session-panel]').getByText('release-readiness').first();
  await runRow.waitFor({ timeout: 10000 });
  const runMark = await page.screencast.showOverlay(label(await runRow.boundingBox(), 'A workflow still running — open it'));
  await page.waitForTimeout(1800);
  await tap(runRow, 'pointer', 'drill into the run');
  await runMark.dispose();
  // Hold on the run panel: four phases, the agent grid, tokens, and what is up next.
  await page.waitForTimeout(4200);

  // ---- Quick task ----------------------------------------------------------
  await chapter('Capture a task without leaving', { duration: 1600 });
  await tap(page.getByTestId('session-panel-rail-tasks'), 'pointer', 'tasks');
  await page.waitForTimeout(1400);
  const taskInput = page.getByTestId('session-panel-tasks-new');
  await tap(taskInput, 'text', 'quick task');
  await taskInput.pressSequentially('Cover summarize() with tests', { delay: 55 });
  await page.waitForTimeout(600);
  await taskInput.press('Enter');
  await page.waitForTimeout(2400);

  await page.screencast.stop();
  return JSON.stringify({ video: OUT, size: SIZE, durationMs: Date.now() - t0, marks });
}
